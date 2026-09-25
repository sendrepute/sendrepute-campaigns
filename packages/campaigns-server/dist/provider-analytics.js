import { randomUUID } from "node:crypto";
import { Router } from "express";
import { ProviderAnalyticsError, normalizeProviderAnalyticsWebhook, providerAnalyticsCapability, providerAnalyticsEventKey, syncProviderAnalytics, } from "@workspace/campaigns-delivery";
import { appendDeliveryEvent, refreshCampaignDeliveryStatistics } from "./delivery-reliability.js";
function credentials(secret) {
    try {
        const value = JSON.parse(secret);
        return value && typeof value === "object" && !Array.isArray(value) ? value : { password: secret };
    }
    catch {
        return { password: secret };
    }
}
/** Converts the existing public provider body plus its decrypted-at-runtime secret. */
export function providerAnalyticsConfig(provider, decryptedSecret) {
    const type = String(provider.type);
    const metadata = provider.metadata && typeof provider.metadata === "object" && !Array.isArray(provider.metadata) ? provider.metadata : {};
    const value = credentials(decryptedSecret);
    if (type === "ses")
        return {
            type, region: String(value.region ?? metadata.region), accessKeyId: String(value.accessKeyId ?? provider.username),
            secretAccessKey: String(value.secretAccessKey ?? decryptedSecret),
            ...(value.sessionToken ? { sessionToken: String(value.sessionToken) } : {}),
            ...(value.configurationSetName ?? metadata.configurationSetName ? { configurationSetName: String(value.configurationSetName ?? metadata.configurationSetName) } : {}),
        };
    if (type === "mailjet")
        return { type, apiKey: String(value.apiKey ?? provider.username), secretKey: String(value.secretKey ?? decryptedSecret) };
    if (type === "smtpcom")
        return { type, apiKey: String(value.apiKey ?? decryptedSecret), channel: String(value.channel ?? metadata.channel ?? provider.username) };
    if (type === "sendgrid")
        return { type, apiKey: String(value.apiKey ?? decryptedSecret) };
    if (type === "mailgun")
        return { type, apiKey: String(value.apiKey ?? decryptedSecret), domain: String(value.domain ?? metadata.domain ?? provider.username), region: metadata.region === "eu" ? "eu" : "us" };
    if (type === "postmark")
        return { type, serverToken: String(value.serverToken ?? value.apiKey ?? decryptedSecret) };
    if (type === "resend")
        return { type, apiKey: String(value.apiKey ?? decryptedSecret) };
    if (type === "brevo")
        return { type, apiKey: String(value.apiKey ?? decryptedSecret) };
    if (type === "smtp")
        return {
            type, host: String(provider.host), port: Number(provider.port),
            username: provider.username ? String(provider.username) : undefined,
            password: String(value.password ?? decryptedSecret),
        };
    throw new Error("Unsupported provider type");
}
async function providerRow(db, providerId) {
    return (await db.query("SELECT body,secret FROM campaigns.entities WHERE kind='providers' AND id=$1", [providerId])).rows[0];
}
/** Shared by polling and existing authenticated webhook handlers. */
export async function ingestProviderAnalyticsEvents(db, providerId, events, source) {
    let imported = 0;
    let duplicate = 0;
    const campaigns = new Set();
    for (const value of events.slice(0, 500)) {
        const key = providerAnalyticsEventKey(value);
        const job = (await db.query(`SELECT id,campaign_id,recipient_id FROM campaigns.jobs
       WHERE provider_message_id=$2
         AND (snapshot->>'providerId'=$1 OR snapshot->>'provider_id'=$1)
       ORDER BY created_at DESC LIMIT 1`, [providerId, value.providerMessageId])).rows[0];
        const inserted = await db.query(`INSERT INTO campaigns.provider_analytics_events
       (id,provider_id,job_id,campaign_id,provider_message_id,event_type,occurred_at,
        recipient,link,canonical_fingerprint,provider_event_key,source,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(provider_id,provider_event_key) DO NOTHING RETURNING id`, [randomUUID(), providerId, job?.id ?? null, job?.campaign_id ?? null, value.providerMessageId,
            value.type, value.occurredAt, value.recipient ?? null, value.link ?? null,
            value.canonicalFingerprint, key, source, value.metadata ?? {}]);
        if (!inserted.rowCount) {
            duplicate++;
            continue;
        }
        imported++;
        if (job?.campaign_id)
            campaigns.add(job.campaign_id);
        if (job) {
            const deliveryType = value.type === "delivered" ? "provider_delivered"
                : value.type === "opened" ? "provider_opened"
                    : value.type === "clicked" ? "provider_clicked"
                        : value.type === "complained" ? "provider_complained"
                            : value.type === "unsubscribed" ? "provider_unsubscribed"
                                : value.type === "soft_bounce" ? "provider_soft_bounced"
                                    : "provider_bounced";
            await appendDeliveryEvent(db, {
                jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                type: deliveryType, source: "provider", providerMessageId: value.providerMessageId,
                providerEventKey: key, occurredAt: new Date(value.occurredAt),
                metadata: {
                    analyticsSource: source,
                    ...(value.type === "hard_bounce" ? { bounceClass: "hard" } : {}),
                    ...(value.type === "soft_bounce" ? { bounceClass: "soft" } : {}),
                },
            });
        }
    }
    for (const campaignId of campaigns)
        await refreshCampaignDeliveryStatistics(db, campaignId);
    return { imported, duplicate, campaignIds: [...campaigns] };
}
export async function ingestProviderAnalyticsWebhook(db, providerId, providerType, authenticatedPayload) {
    const state = (await db.query("SELECT enabled,track_opens,track_clicks FROM campaigns.provider_analytics_state WHERE provider_id=$1", [providerId])).rows[0];
    if (!state?.enabled)
        return { imported: 0, duplicate: 0, campaignIds: [] };
    const events = normalizeProviderAnalyticsWebhook(providerType, authenticatedPayload).filter(value => (value.type !== "opened" || state.track_opens) && (value.type !== "clicked" || state.track_clicks));
    return ingestProviderAnalyticsEvents(db, providerId, events, "webhook");
}
function publicError(error) {
    if (error instanceof ProviderAnalyticsError)
        return { kind: error.kind, message: error.message.slice(0, 1000) };
    return { kind: "provider", message: "Provider analytics sync failed" };
}
// Match entity authorization: every assigned campaign list must be allowed.
// Unknown/deleted campaigns and empty or malformed list assignments fail closed.
const analyticsListScope = `($5::text[] IS NULL OR EXISTS (
  SELECT 1 FROM campaigns.entities c
  WHERE c.kind='campaigns' AND c.id=e.campaign_id
    AND CASE WHEN jsonb_typeof(c.body->'listIds')='array' THEN
      jsonb_array_length(c.body->'listIds')>0 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(c.body->'listIds') assigned(id)
        WHERE assigned.id IS NULL OR NOT assigned.id=ANY($5::text[])
      )
    ELSE false END
))`;
export function createProviderAnalyticsRouter(deps) {
    const router = Router();
    const read = async (id) => {
        const row = await providerRow(deps.db, id);
        if (!row)
            throw deps.http(404, "Provider not found");
        return row;
    };
    router.get("/providers/:providerId/analytics/status", deps.need("read"), deps.wrap(async (request, response) => {
        const provider = await read(String(request.params.providerId));
        const capability = providerAnalyticsCapability(String(provider.body.type));
        const state = (await deps.db.query(`SELECT enabled,cursor,track_opens "trackOpens",track_clicks "trackClicks",
       webhook_configured "webhookConfigured",last_sync_at "lastSyncAt",
       last_success_at "lastSuccessAt",last_error_kind "lastErrorKind",last_error "lastError"
       FROM campaigns.provider_analytics_state WHERE provider_id=$1`, [request.params.providerId])).rows[0];
        response.json({ data: { providerId: request.params.providerId, capability, enabled: state?.enabled === true, tracking: {
                    opens: state?.trackOpens === true, clicks: state?.trackClicks === true,
                }, webhookConfigured: state?.webhookConfigured === true, cursor: state?.cursor ?? null, lastSyncAt: state?.lastSyncAt ?? null,
                lastSuccessAt: state?.lastSuccessAt ?? null, error: state?.lastErrorKind ? { kind: state.lastErrorKind, message: state.lastError } : null } });
    }));
    router.put("/providers/:providerId/analytics/config", deps.mutation, deps.need("provider-analytics:manage"), deps.wrap(async (request, response) => {
        const providerId = String(request.params.providerId);
        const provider = await read(providerId);
        const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
        if (typeof body.enabled !== "boolean")
            throw deps.http(400, "enabled must be a boolean");
        if (Object.keys(body).some(key => !["enabled", "tracking", "webhookConfigured"].includes(key)))
            throw deps.http(400, "Unknown analytics configuration field");
        const tracking = body.tracking && typeof body.tracking === "object" && !Array.isArray(body.tracking) ? body.tracking : {};
        if (Object.keys(tracking).some(key => !["opens", "clicks"].includes(key)) ||
            [tracking.opens, tracking.clicks].some(value => value !== undefined && typeof value !== "boolean")) {
            throw deps.http(400, "Invalid tracking configuration");
        }
        if (body.webhookConfigured !== undefined && typeof body.webhookConfigured !== "boolean")
            throw deps.http(400, "webhookConfigured must be a boolean");
        const capability = providerAnalyticsCapability(String(provider.body.type));
        if (body.enabled && capability.availability === "unavailable")
            throw deps.http(409, capability.reason ?? "Provider analytics is unavailable");
        await deps.db.query(`INSERT INTO campaigns.provider_analytics_state
       (provider_id,enabled,track_opens,track_clicks,webhook_configured,updated_at)
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT(provider_id) DO UPDATE SET enabled=excluded.enabled,
       track_opens=excluded.track_opens,track_clicks=excluded.track_clicks,
       webhook_configured=excluded.webhook_configured,updated_at=now()`, [providerId, body.enabled, tracking.opens === true, tracking.clicks === true, body.webhookConfigured === true]);
        await deps.audit?.(request, "provider.analytics.configure", "provider", providerId, { enabled: body.enabled });
        response.json({ data: { providerId, enabled: body.enabled, tracking: { opens: tracking.opens === true, clicks: tracking.clicks === true }, webhookConfigured: body.webhookConfigured === true, capability } });
    }));
    router.post("/providers/:providerId/analytics/sync", deps.mutation, deps.need("provider-analytics:manage"), deps.wrap(async (request, response) => {
        const providerId = String(request.params.providerId);
        const provider = await read(providerId);
        const state = (await deps.db.query("SELECT enabled,cursor,track_opens,track_clicks FROM campaigns.provider_analytics_state WHERE provider_id=$1", [providerId])).rows[0];
        if (!state?.enabled)
            throw deps.http(409, "Provider analytics is not enabled");
        if (!provider.secret)
            throw deps.http(409, "Provider credentials are not configured");
        const config = providerAnalyticsConfig(provider.body, deps.decrypt(deps.credentialKey, provider.secret));
        const capability = providerAnalyticsCapability(config.type);
        if (capability.availability === "webhook" || capability.availability === "unavailable") {
            throw deps.http(409, capability.reason ?? "Provider analytics polling is unavailable", "ANALYTICS_UNAVAILABLE");
        }
        const ids = config.type === "resend" ? (await deps.db.query(`SELECT DISTINCT provider_message_id FROM campaigns.jobs
       WHERE provider_message_id IS NOT NULL
         AND (snapshot->>'providerId'=$1 OR snapshot->>'provider_id'=$1)
       ORDER BY provider_message_id LIMIT 100`, [providerId])).rows.map(row => row.provider_message_id) : undefined;
        try {
            const result = await (deps.sync ?? syncProviderAnalytics)(config, { cursor: state.cursor, limit: 100, providerMessageIds: ids }, deps.deliveryOptions);
            const selected = result.events.filter(value => (value.type !== "opened" || state.track_opens) && (value.type !== "clicked" || state.track_clicks));
            const ingested = await ingestProviderAnalyticsEvents(deps.db, providerId, selected, "poll");
            await deps.db.query(`UPDATE campaigns.provider_analytics_state SET cursor=$2,last_sync_at=now(),
         last_success_at=now(),last_error_kind=NULL,last_error=NULL,updated_at=now()
         WHERE provider_id=$1`, [providerId, result.nextCursor]);
            await deps.audit?.(request, "provider.analytics.sync", "provider", providerId, { imported: ingested.imported, duplicate: ingested.duplicate });
            response.json({ data: { status: "available", imported: ingested.imported, duplicate: ingested.duplicate, nextCursor: result.nextCursor, hasMore: result.hasMore, error: null } });
        }
        catch (error) {
            const safe = publicError(error);
            await deps.db.query(`UPDATE campaigns.provider_analytics_state SET last_sync_at=now(),
         last_error_kind=$2,last_error=$3,updated_at=now() WHERE provider_id=$1`, [providerId, safe.kind, safe.message]);
            response.status(safe.kind === "authentication" ? 401 : safe.kind === "permission" ? 403 : safe.kind === "rate_limited" ? 429 : 502)
                .json({ data: { status: "error", imported: 0, duplicate: 0, nextCursor: state.cursor, hasMore: false, error: safe } });
        }
    }));
    router.get("/providers/:providerId/analytics/events", deps.need("read"), deps.wrap(async (request, response) => {
        const providerId = String(request.params.providerId);
        await read(providerId);
        const page = deps.page(request);
        const campaignId = request.query.campaignId ? String(request.query.campaignId) : null;
        const result = await deps.db.query(`SELECT id,provider_message_id "providerMessageId",event_type "type",occurred_at "occurredAt",
       recipient,link,source,campaign_id "campaignId",job_id "jobId",count(*) OVER()::int "_total"
       FROM campaigns.provider_analytics_events e
       WHERE provider_id=$1 AND ($2::uuid IS NULL OR campaign_id=$2)
         AND ${analyticsListScope}
       ORDER BY occurred_at DESC,id DESC LIMIT $3 OFFSET $4`, [providerId, campaignId, page.pageSize, page.offset, deps.restrictedLists(request)]);
        const total = Number(result.rows[0]?._total ?? 0);
        response.json({ data: result.rows.map(({ _total, ...row }) => row), meta: { page: page.page, pageSize: page.pageSize, total } });
    }));
    router.get("/reports/provider-analytics", deps.need("read"), deps.wrap(async (request, response) => {
        const page = deps.page(request);
        const campaignId = request.query.campaignId ? String(request.query.campaignId) : null;
        const providerId = request.query.providerId ? String(request.query.providerId) : null;
        const result = await deps.db.query(`SELECT e.provider_id "providerId",e.campaign_id "campaignId",
       count(DISTINCT job_id) FILTER(WHERE event_type='delivered')::int delivered,
       count(DISTINCT job_id) FILTER(WHERE event_type='opened')::int opened,
       count(DISTINCT job_id) FILTER(WHERE event_type='clicked')::int clicked,
       count(DISTINCT job_id) FILTER(WHERE event_type='hard_bounce')::int "hardBounced",
       count(DISTINCT job_id) FILTER(WHERE event_type='soft_bounce')::int "softBounced",
       count(DISTINCT job_id) FILTER(WHERE event_type='complained')::int complained,
       count(*) OVER()::int "_total",p.body->>'type' "providerType",
       s.track_opens "trackOpens",s.track_clicks "trackClicks"
       FROM campaigns.provider_analytics_events e
       JOIN campaigns.entities p ON p.kind='providers' AND p.id=e.provider_id
       JOIN campaigns.provider_analytics_state s ON s.provider_id=e.provider_id
       WHERE ($1::uuid IS NULL OR e.campaign_id=$1) AND ($2::uuid IS NULL OR e.provider_id=$2)
         AND ${analyticsListScope}
       GROUP BY e.provider_id,e.campaign_id,p.body,s.track_opens,s.track_clicks
       ORDER BY e.campaign_id DESC NULLS LAST,e.provider_id LIMIT $3 OFFSET $4`, [campaignId, providerId, page.pageSize, page.offset, deps.restrictedLists(request)]);
        const total = Number(result.rows[0]?._total ?? 0);
        const data = result.rows.map(({ _total, providerType, trackOpens, trackClicks, ...row }) => {
            const capability = providerAnalyticsCapability(providerType);
            return Object.fromEntries(Object.entries(row).map(([key, value]) => {
                const metric = key === "hardBounced" ? "hard_bounce" : key === "softBounced" ? "soft_bounce" : key === "complained" ? "complained" : key;
                const disabled = (key === "opened" && !trackOpens) || (key === "clicked" && !trackClicks);
                return [key, disabled || (key in capability.metrics && !capability.metrics[metric]) ? null : value];
            }));
        });
        response.json({ data, meta: { page: page.page, pageSize: page.pageSize, total } });
    }));
    return router;
}
//# sourceMappingURL=provider-analytics.js.map