import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express, { Router } from "express";
import { Pool } from "pg";
import { PRODUCTION_API_BASE_URL, PRODUCTION_HOSTED_BUILDER_ORIGIN, SendReputeClient, assertHostedBuilderLaunch, operationCapabilities, } from "@workspace/campaigns-bridge";
import { createExperimentsRouter } from "./experiments.js";
import { parseSesSnsWebhook, parseTokenWebhook, sendMessage, verifyProvider, } from "@workspace/campaigns-delivery";
import { appendDeliveryEvent, createDeliveryReliabilityRouter, refreshCampaignDeliveryStatistics, } from "./delivery-reliability.js";
import { createTelegramNotificationsRouter, enqueueCampaignNotification, runTelegramNotificationWorker, sendTelegramMessage, } from "./telegram-notifications.js";
import { createAudienceRouter, createAudienceSnapshot, createPostgresAudienceRepository, compileAudiencePredicate, renderMergeVariables, validateCustomFieldDefinitions, validateCustomValues, } from "./audience.js";
import { createBrandsRouter, getBrandDefaults } from "./brands.js";
import { cancelQueuedSubscriberJobs, createHousekeepingRouter } from "./housekeeping.js";
import { createRulesWebhooksRouter, recordRuleEvent, runRulesWebhookWorker } from "./rules-webhooks.js";
import { createSubscriptionCustomizationRouter, getSubscriptionCustomization, onSubscribeConfirmed, onUnsubscribe, resolveListDoubleOptIn } from "./subscription-customization.js";
import { createCampaignTrackingLinks, createDomainsTrackingRouter, createPostgresTrackingEventRecorder } from "./domains-tracking.js";
import { createProviderAnalyticsRouter } from "./provider-analytics.js";
import { publicSubscriptionFailure } from "./public-subscription-errors.js";
export * from "./delivery-contract.generated.js";
export { enqueueCampaignNotification, runTelegramNotificationWorker, sendTelegramMessage, } from "./telegram-notifications.js";
import { createAutomationsRouter, advanceAutomations } from "./automations.js";
const scrypt = promisify(nodeScrypt);
const VERSION = "0.1.0";
const COOKIE = "campaigns_session";
const MAX_BODY = 4 * 1024 * 1024;
const DELIVERY_RESTORE_LOCK = 731_946_215;
const LAST_OWNER_LOCK = 731_946_217;
const PUBLIC_SUBSCRIPTION_LOCK = 731_946_218;
// Applied uniformly before looking up the address: enough room for ordinary
// retries, but still bounded independently of the per-IP abuse budget.
const PUBLIC_SIGNUP_EMAIL_DAILY_LIMIT = 12;
const MAX_PENDING_OPTIN_JOBS = 1_000;
const MIGRATION_LOCK = 731_946_216;
const KINDS = ["lists", "subscribers", "campaigns", "providers", "templates"];
async function lockSubscribers(tx) {
    // Migration 012's subscriber automation trigger takes DELIVERY_RESTORE_LOCK
    // on INSERT/UPDATE. Restore and workers take it first too: never hold the
    // subscriber lock while waiting for delivery.
    await tx.query("SELECT pg_advisory_xact_lock($1)", [DELIVERY_RESTORE_LOCK]);
    await tx.query("SELECT pg_advisory_xact_lock($1)", [PUBLIC_SUBSCRIPTION_LOCK]);
}
/** Independent of delivery/activation: an idle installation must still erase expired payloads. */
export async function cleanupCampaignInsightRetention(db, now = new Date()) {
    await db.query("DELETE FROM campaigns.insight_requests WHERE created_at <= $1::timestamptz - interval '30 days'", [now.toISOString()]);
}
/**
 * Keep a self-hosted Campaigns installation in its own PostgreSQL database
 * without copying credentials into another environment variable.
 */
export function campaignsDatabaseUrl(environment = process.env) {
    const databaseUrl = environment.DATABASE_URL;
    const databaseName = environment.CAMPAIGNS_DATABASE_NAME;
    if (!databaseUrl || !databaseName)
        return databaseUrl;
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName)) {
        throw new Error("CAMPAIGNS_DATABASE_NAME must be a valid lowercase PostgreSQL database name");
    }
    const url = new URL(databaseUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
}
const permissions = {
    owner: ["*", "subscribers:export"],
    admin: ["read", "lists:manage", "subscribers:manage", "subscribers:export", "campaigns:manage", "campaigns:send", "audiences:read", "audiences:manage", "delivery:reconcile", "delivery:retry", "providers:manage", "templates:manage", "brands:manage", "housekeeping:manage", "users:manage", "roles:manage", "settings:manage", "connection:manage", "api:use", "api:spend", "backup:manage"],
    manager: ["read", "lists:manage", "subscribers:manage", "subscribers:export", "campaigns:manage", "campaigns:send", "audiences:read", "audiences:manage", "delivery:reconcile", "delivery:retry", "providers:manage", "templates:manage", "brands:manage", "api:use"],
    editor: ["read", "lists:manage", "subscribers:manage", "campaigns:manage", "templates:manage", "audiences:read"],
    analyst: ["read", "audiences:read"],
};
const demoNow = "2025-01-15T12:00:00.000Z";
const demoIds = {
    list: "00000000-0000-4000-8000-000000000101",
    sub: "00000000-0000-4000-8000-000000000102",
    campaign: "00000000-0000-4000-8000-000000000103",
    provider: "00000000-0000-4000-8000-000000000104",
    template: "00000000-0000-4000-8000-000000000105",
};
const demo = {
    lists: [{ id: demoIds.list, name: "Product updates", description: "Confirmed product subscribers", subscriberCount: 1, metadata: {}, createdAt: demoNow, updatedAt: demoNow }],
    subscribers: [{ id: demoIds.sub, email: "a***@example.com", firstName: "Demo", lastName: "Subscriber", status: "subscribed", listIds: [demoIds.list], tags: [], confirmedAt: demoNow, unsubscribedAt: null, metadata: {}, createdAt: demoNow, updatedAt: demoNow }],
    providers: [{ id: demoIds.provider, name: "Demo SMTP", type: "smtp", enabled: true, configured: true, host: "smtp.example.invalid", port: 587, username: null, metadata: {}, createdAt: demoNow, updatedAt: demoNow }],
    templates: [{ id: demoIds.template, name: "Product announcement", subject: "A useful update", html: "<p>Product news</p>", text: "Product news", metadata: {}, createdAt: demoNow, updatedAt: demoNow }],
    campaigns: [{ id: demoIds.campaign, name: "January update", subject: "A useful update", previewText: "What is new", fromName: "SendRepute", fromEmail: "news@example.com", replyTo: null, listIds: [demoIds.list], templateId: demoIds.template, providerId: demoIds.provider, status: "sent", scheduledAt: demoNow, statistics: { recipients: 1, sent: 1, delivered: 1, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 }, metadata: {}, createdAt: demoNow, updatedAt: demoNow }],
};
const demoDashboard = {
    totals: { lists: 1, subscribers: 1, campaigns: 1, sent: 1, delivered: 1, opened: 0, clicked: 0 },
    recentActivity: [{ id: "00000000-0000-4000-8000-000000000106", type: "campaign.sent", message: "January update completed", actorName: "Demo", createdAt: demoNow, metadata: {} }],
};
function hash(value) {
    return createHash("sha256").update(value).digest("hex");
}
function equalText(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
async function passwordHash(password) {
    const salt = randomBytes(16);
    const result = await scrypt(password, salt, 64);
    return `scrypt$16384$8$1$${salt.toString("base64")}$${result.toString("base64")}`;
}
async function passwordVerify(encoded, password) {
    const parts = encoded.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt")
        return false;
    const actual = Buffer.from(parts[5], "base64");
    const result = await scrypt(password, Buffer.from(parts[4], "base64"), actual.length);
    return actual.length === result.length && timingSafeEqual(actual, result);
}
function validatePassword(value) {
    if (typeof value !== "string" || value.length < 12 || value.length > 1024) {
        throw http(400, "Password must be between 12 and 1024 characters");
    }
    return value;
}
function encrypted(key, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}
function decrypted(key, value) {
    const [version, iv, tag, body] = value.split(".");
    if (version !== "v1" || !iv || !tag || !body)
        throw new Error("Invalid encrypted credential");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
function secureFile(path, bytes = 32) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(path))
        writeFileSync(path, randomBytes(bytes), { mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return readFileSync(path);
}
function installerToken(dataDir) {
    const path = join(dataDir, "installer-token");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!existsSync(path))
        writeFileSync(path, randomBytes(32).toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return readFileSync(path, "utf8").trim();
}
function parseCookies(request) {
    const result = {};
    for (const item of (request.headers.cookie ?? "").split(";")) {
        const at = item.indexOf("=");
        if (at > 0)
            result[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1));
    }
    return result;
}
function json(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw http(400, "Body must be a JSON object");
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BODY)
        throw http(413, "Request body too large");
    return value;
}
function http(status, message, code) {
    return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
const ACTIVATION_SCOPES = ["account:read", "catalog:read", "usage:read"];
function safeUpstreamField(value, pattern) {
    return typeof value === "string" && value.length <= 128 && pattern.test(value) ? value : undefined;
}
function activationError(error) {
    const source = error && typeof error === "object"
        ? error
        : {};
    const upstreamStatus = Number(source.status);
    const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : 503;
    const upstreamCode = safeUpstreamField(source.code, /^[A-Za-z0-9_.:-]+$/);
    const requestId = safeUpstreamField(source.requestId, /^[A-Za-z0-9_.:-]+$/);
    let result;
    if (status === 401) {
        result = http(401, "The SendRepute API key is invalid, revoked, or expired.", upstreamCode ?? "INVALID_API_KEY");
    }
    else if (status === 403 && upstreamCode === "ACCOUNT_DISABLED") {
        result = http(403, "The SendRepute account is disabled.", "ACCOUNT_DISABLED");
    }
    else if (status === 403 && upstreamCode === "INSUFFICIENT_SCOPE") {
        result = http(403, `The SendRepute API key needs these scopes: ${ACTIVATION_SCOPES.join(", ")}.`, "INSUFFICIENT_SCOPE");
        result.requiredScopes = ACTIVATION_SCOPES;
    }
    else if (status === 403) {
        result = http(403, "The SendRepute account or API key does not permit activation.", upstreamCode ?? "ACTIVATION_FORBIDDEN");
    }
    else if (status === 404) {
        result = http(404, "The SendRepute activation endpoint is not available.", upstreamCode ?? "ACTIVATION_ENDPOINT_NOT_FOUND");
    }
    else if (status === 429) {
        result = http(429, "SendRepute activation is rate limited; retry later.", upstreamCode ?? "RATE_LIMITED");
    }
    else if (status >= 500) {
        result = http(status, "SendRepute activation service is unavailable.", upstreamCode ?? "ACTIVATION_UNAVAILABLE");
    }
    else {
        result = http(503, "SendRepute activation could not reach the service.", upstreamCode ?? "ACTIVATION_TRANSPORT_ERROR");
    }
    if (requestId)
        result.requestId = requestId;
    return result;
}
function page(request) {
    const integer = (value, name, fallback) => {
        if (value === undefined)
            return fallback;
        // Reject arrays (including repeated parameters), fractions and non-finite
        // numbers before passing LIMIT/OFFSET to PostgreSQL.
        if (typeof value !== "string" || !/^[0-9]+$/.test(value))
            throw http(400, `Invalid ${name}`);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1)
            throw http(400, `Invalid ${name}`);
        return parsed;
    };
    const value = Math.min(100, integer(request.query.pageSize, "pageSize", 25));
    // At 100 rows/page this bounds the largest database OFFSET to 999,900.
    const current = integer(request.query.page, "page", 1);
    if (current > 10_000)
        throw http(400, "Invalid page");
    return { page: current, pageSize: value, offset: (current - 1) * value };
}
function date(value) {
    const parsed = new Date(String(value));
    if (!Number.isFinite(parsed.getTime()))
        throw http(400, "Invalid RFC 3339 date");
    return parsed.toISOString();
}
function email(value) {
    const result = String(value ?? "").trim().toLowerCase();
    if (result.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result))
        throw http(400, "Invalid email address");
    return result;
}
function publicUrl(value) {
    let result;
    try {
        result = new URL(String(value));
    }
    catch {
        throw http(400, "Invalid public URL");
    }
    if (!["http:", "https:"].includes(result.protocol) || result.username || result.password ||
        result.search || result.hash) {
        throw http(400, "Public URL must be an HTTP(S) URL without credentials, query, or fragment");
    }
    return result;
}
function deliveryPublicUrl(value) {
    let url;
    try {
        url = publicUrl(value);
    }
    catch {
        throw Object.assign(new Error("A valid public unsubscribe URL is required"), { deliveryState: "not-sent", code: "UNSUBSCRIBE_UNAVAILABLE" });
    }
    // Local development may use plain HTTP on loopback only. Public one-click
    // links must not downgrade to HTTP or contain URL parser ambiguities.
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
        /[\r\n]/.test(url.toString())) {
        throw Object.assign(new Error("A secure public unsubscribe URL is required"), { deliveryState: "not-sent", code: "UNSUBSCRIBE_UNAVAILABLE" });
    }
    return url.toString();
}
const UNSUBSCRIBE_PLACEHOLDER = /\{\{\s*unsubscribe_url\s*\}\}/gi;
function escapeHtmlAttribute(value) {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
export function populateUnsubscribeContent(html, text, unsubscribeUrl) {
    const htmlHasPlaceholder = UNSUBSCRIBE_PLACEHOLDER.test(html);
    UNSUBSCRIBE_PLACEHOLDER.lastIndex = 0;
    const textHasPlaceholder = UNSUBSCRIBE_PLACEHOLDER.test(text);
    UNSUBSCRIBE_PLACEHOLDER.lastIndex = 0;
    return {
        html: htmlHasPlaceholder
            ? html.replace(UNSUBSCRIBE_PLACEHOLDER, escapeHtmlAttribute(unsubscribeUrl))
            : `${html}<p><a href="${escapeHtmlAttribute(unsubscribeUrl)}">Unsubscribe</a></p>`,
        text: textHasPlaceholder
            ? text.replace(UNSUBSCRIBE_PLACEHOLDER, unsubscribeUrl)
            : `${text}\n\nUnsubscribe: ${unsubscribeUrl}`,
    };
}
function subscriptionListToken(key, listId) {
    return createHmac("sha256", key).update(`public-subscribe:${listId}`).digest("base64url");
}
export function publicSubscriptionUrl(publicUrl, listId, listToken) {
    const value = publicCampaignsPageUrl(publicUrl, "subscribe");
    value.searchParams.set("listId", listId);
    value.searchParams.set("listToken", listToken);
    return value.toString();
}
export function publicCampaignsPageUrl(publicUrl, page) {
    const base = new URL(publicUrl);
    if (!base.pathname.endsWith("/"))
        base.pathname += "/";
    return new URL(page, base);
}
function testRecipients(body) {
    fields(body, ["recipients", "recipient"]);
    const hasRecipients = Object.prototype.hasOwnProperty.call(body, "recipients");
    const hasRecipient = Object.prototype.hasOwnProperty.call(body, "recipient");
    if (hasRecipients === hasRecipient)
        throw http(400, "Provide exactly one of recipients or legacy recipient");
    const values = hasRecipients ? body.recipients : [body.recipient];
    if (!Array.isArray(values) || values.length < 1 || values.length > 2) {
        throw http(400, "recipients must contain one or two email addresses");
    }
    const normalized = values.map(value => {
        if (typeof value !== "string")
            throw http(400, "recipients must contain email address strings");
        return email(value);
    });
    if (new Set(normalized).size !== normalized.length) {
        throw http(400, "recipients must be unique after normalization");
    }
    return normalized;
}
function subscriberTags(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 50)
        throw http(400, "tags must be an array of at most 50 strings");
    const tags = value.map(item => {
        if (typeof item !== "string")
            throw http(400, "tags must contain strings");
        const tag = item.trim();
        if (!tag || tag.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(tag))
            throw http(400, "Invalid subscriber tag");
        return tag;
    });
    if (new Set(tags).size !== tags.length)
        throw http(400, "tags must be unique");
    return tags;
}
function fields(body, allowed, required = []) {
    for (const field of Object.keys(body))
        if (!allowed.includes(field))
            throw http(400, `Unknown field: ${field}`);
    for (const field of required)
        if (body[field] === undefined || body[field] === "")
            throw http(400, `Missing field: ${field}`);
}
function validateJsonData(value, path = "metadata") {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw http(400, `${path} must contain only finite JSON numbers`);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateJsonData(item, `${path}[${index}]`));
        return;
    }
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
        throw http(400, `${path} must contain JSON-compatible data`);
    }
    for (const [key, item] of Object.entries(value))
        validateJsonData(item, `${path}.${key}`);
}
function validateTemplate(value) {
    if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 160)
        throw http(400, "Template name must be between 1 and 160 characters");
    if (typeof value.subject !== "string" || value.subject.length < 1 || value.subject.length > 255)
        throw http(400, "Template subject must be between 1 and 255 characters");
    if (typeof value.html !== "string" || value.html.length < 1)
        throw http(400, "Template HTML is required");
    if (typeof value.text !== "string")
        throw http(400, "Template text must be a string");
    if (value.metadata !== undefined) {
        if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))
            throw http(400, "Template metadata must be a JSON object");
        validateJsonData(value.metadata);
    }
}
function csvCell(value) {
    let text = value == null ? "" : String(value);
    // Spreadsheet applications can ignore leading spaces/control characters
    // before interpreting a formula sigil. Public subscriber fields therefore
    // need protection even when the dangerous character is not byte zero.
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text))
        text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}
function csvRows(source) {
    if (Buffer.byteLength(source) > MAX_BODY)
        throw http(413, "CSV too large");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted && c === '"' && source[i + 1] === '"') {
            field += '"';
            i++;
        }
        else if (c === '"')
            quoted = !quoted;
        else if (!quoted && c === ",") {
            row.push(field);
            field = "";
        }
        else if (!quoted && (c === "\n" || c === "\r")) {
            if (c === "\r" && source[i + 1] === "\n")
                i++;
            row.push(field);
            if (row.some(Boolean))
                rows.push(row);
            row = [];
            field = "";
        }
        else
            field += c;
    }
    row.push(field);
    if (row.some(Boolean))
        rows.push(row);
    if (quoted)
        throw http(400, "Malformed CSV");
    return rows.slice(0, 10001);
}
async function consumePublicBudget(db, fingerprint, limit, window) {
    // Keep the persistent limiter from becoming an attacker-controlled,
    // append-only store. The expiry index makes this bounded cleanup cheap.
    await db.query("DELETE FROM campaigns.public_rate_limits WHERE fingerprint IN (SELECT fingerprint FROM campaigns.public_rate_limits WHERE reset_at<=now() ORDER BY reset_at LIMIT 100)");
    const result = await db.query(`INSERT INTO campaigns.public_rate_limits(fingerprint,used,reset_at)
     VALUES($1,1,now()+$3::interval)
     ON CONFLICT(fingerprint) DO UPDATE SET
       used=CASE
         WHEN campaigns.public_rate_limits.reset_at<=now() THEN 1
         ELSE least(campaigns.public_rate_limits.used+1,$2+1)
       END,
       reset_at=CASE
         WHEN campaigns.public_rate_limits.reset_at<=now() THEN now()+$3::interval
         ELSE campaigns.public_rate_limits.reset_at
       END
     RETURNING used`, [fingerprint, limit, window]);
    if ((result.rows[0]?.used ?? limit + 1) > limit)
        throw http(429, "Too many subscription requests");
}
async function migrate(db) {
    const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const connect = db.connect;
    const client = connect ? await connect.call(db) : db;
    let transaction = false;
    try {
        for (let attempt = 0;; attempt++) {
            await client.query("BEGIN");
            transaction = true;
            // Workers hold DELIVERY_RESTORE_LOCK across the entire tick. Take it
            // before the migration lock and before any DDL, on this same connection.
            await client.query("SELECT pg_advisory_xact_lock($1)", [DELIVERY_RESTORE_LOCK]);
            await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
            try {
                // Subscriber writes acquire a relation lock before their trigger takes
                // DELIVERY_RESTORE_LOCK. Never wait for that relation while holding the
                // advisory lock: release and let the writer finish, then retry admission.
                const entities = await client.query("SELECT to_regclass('campaigns.entities') AS relation");
                if (entities.rows[0]?.relation)
                    await client.query("LOCK TABLE campaigns.entities IN ACCESS EXCLUSIVE MODE NOWAIT");
                break;
            }
            catch (error) {
                if (error.code !== "55P03" || attempt >= 99)
                    throw error;
                await client.query("ROLLBACK");
                transaction = false;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        for (const filename of readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
            await client.query(readFileSync(join(directory, filename), "utf8"));
            // Replayed data migrations can queue reconciliation constraint triggers.
            // Validate before the next file performs DDL (PostgreSQL rejects index/
            // constraint changes on relations with pending trigger events). Remain
            // in this same transaction: any later failure still rolls back everything.
            await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        }
        await client.query("COMMIT");
        transaction = false;
    }
    catch (error) {
        if (transaction) {
            try {
                await client.query("ROLLBACK");
            }
            catch { /* Preserve the migration failure. */ }
        }
        throw error;
    }
    finally {
        if (connect)
            client.release();
    }
}
async function audit(ctx, request, action, entityType, entityId, metadata = {}) {
    const actor = request.user ? { id: request.user.id, name: request.user.name, email: request.user.email, roleIds: request.user.roleIds } : null;
    const safe = JSON.parse(JSON.stringify(metadata, (key, value) => /password|secret|token|api.?key/i.test(key) ? "[REDACTED]" : value));
    await ctx.db.query("INSERT INTO campaigns.audit(id,action,entity_type,entity_id,actor_id,actor,ip_address,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), action, entityType, entityId, request.user?.id ?? null, actor, request.ip ?? null, safe]);
}
function serializedAuditMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const source = value;
    const safe = {};
    if (typeof source.operation === "string" && Object.hasOwn(operationCapabilities, source.operation))
        safe.operation = source.operation;
    const outcomes = new Set(["completed", "success", "failed", "error", "pending", "cancelled"]);
    if (typeof source.outcome === "string" && outcomes.has(source.outcome.toLowerCase()))
        safe.outcome = source.outcome.toLowerCase();
    if (typeof source.status === "string" && outcomes.has(source.status.toLowerCase()))
        safe.status = source.status.toLowerCase();
    if (typeof source.errorCode === "string" && /^[A-Z][A-Z0-9_.-]{0,63}$/.test(source.errorCode))
        safe.errorCode = source.errorCode;
    if (typeof source.durationMs === "number" && Number.isFinite(source.durationMs) && source.durationMs >= 0 && source.durationMs <= 3_600_000)
        safe.durationMs = Math.round(source.durationMs);
    if (typeof source.targetName === "string") {
        const name = source.targetName.trim();
        if (name && name.length <= 120 && !/[@\r\n]|(?:https?:\/\/)|(?:api.?key|token|secret|password)/i.test(name))
            safe.targetName = name;
    }
    return safe;
}
async function loadUser(ctx, request) {
    const token = parseCookies(request)[COOKIE];
    if (!token)
        return;
    const result = await ctx.db.query("SELECT u.id,u.email,u.body,s.csrf_hash,s.csrf_token FROM campaigns.sessions s JOIN campaigns.users u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at>now()", [hash(token)]);
    const row = result.rows[0];
    if (!row)
        return;
    const body = row.body;
    if (body.active === false)
        return;
    const roleIds = body.roleIds ?? [];
    const roles = await ctx.db.query("SELECT body FROM campaigns.roles WHERE id=ANY($1::uuid[])", [roleIds]);
    const granted = [...new Set(roles.rows.flatMap(r => r.body.permissions ?? []))];
    request.user = { ...body, id: String(row.id), email: String(row.email), name: String(body.name), roleIds, permissions: granted };
    request.csrf = String(row.csrf_hash);
    request.csrfToken = String(row.csrf_token);
}
function permitted(request, permission) {
    return !!request.user && (request.user.permissions.includes("*") || request.user.permissions.includes(permission));
}
function need(permission = "read") {
    return (request, _response, next) => {
        if (!request.user)
            return next(http(401, "Authentication required"));
        if (!permitted(request, permission))
            return next(http(403, "Permission denied"));
        next();
    };
}
function mutation(request, _response, next) {
    if (request.query.demo === "true")
        return next(http(405, "Demo data is read-only"));
    if (!request.user)
        return next(http(401, "Authentication required"));
    const supplied = request.get("x-campaigns-csrf");
    if (!supplied || !request.csrf || !equalText(hash(supplied), request.csrf))
        return next(http(403, "Invalid CSRF token"));
    next();
}
function wrap(handler) {
    return (request, response, next) => { handler(request, response).catch(next); };
}
async function installed(ctx) {
    return (await ctx.db.query("SELECT 1 FROM campaigns.installation LIMIT 1")).rowCount === 1;
}
async function connection(ctx) {
    const result = await ctx.db.query("SELECT connection_secret,connection FROM campaigns.installation");
    const row = result.rows[0];
    return row ? { secret: decrypted(ctx.key, row.connection_secret), body: row.connection } : null;
}
async function validActivation(ctx, force = false) {
    const item = await connection(ctx);
    if (!item)
        throw http(503, "Campaigns is not installed", "UNAVAILABLE");
    const checked = item.body.lastCheckedAt ? new Date(String(item.body.lastCheckedAt)).getTime() : 0;
    if (!force && item.body.connected === true && ctx.now().getTime() - checked < ctx.activationRevalidateMs)
        return item.body;
    try {
        const client = ctx.bridgeFactory(item.secret);
        const snapshot = await client.getConnectionSnapshot();
        const balance = snapshot.balance;
        const next = { ...item.body, connected: true, error: null, balanceMillicents: Number(balance?.availableMillicents ?? 0), lastCheckedAt: ctx.now().toISOString(), snapshot };
        await ctx.db.query("UPDATE campaigns.installation SET connection=$1", [next]);
        return next;
    }
    catch (error) {
        const failure = activationError(error);
        const next = { ...item.body, connected: false, error: failure.message, lastCheckedAt: ctx.now().toISOString() };
        await ctx.db.query("UPDATE campaigns.installation SET connection=$1", [next]);
        throw failure;
    }
}
function safeConnection(value) {
    const { activation: _activation, ...safe } = value;
    const configuredApiBaseUrl = safe.apiBaseUrl;
    const apiBaseUrl = configuredApiBaseUrl === undefined ? PRODUCTION_API_BASE_URL : configuredApiBaseUrl;
    return {
        ...safe,
        apiBaseUrl,
        // Older installations may predate this field. A missing value safely
        // derives from the fixed published API endpoint; an explicit mismatch is
        // never converted into trusted configuration.
        hostedBuilderOrigin: apiBaseUrl === PRODUCTION_API_BASE_URL
            ? PRODUCTION_HOSTED_BUILDER_ORIGIN
            : null,
    };
}
function statusData(isInstalled, request, activated) {
    return { installed: isInstalled, activated, demo: !isInstalled, version: VERSION, user: request.user ? { id: request.user.id, name: request.user.name, email: request.user.email, roleIds: request.user.roleIds, permissions: request.user.permissions, ...(Array.isArray(request.user.listIds) ? { listIds: request.user.listIds } : {}) } : null, csrfToken: request.user ? request.csrfToken ?? null : null };
}
function publicEntity(kind, body) {
    if (kind === "providers") {
        const { secret: _secret, ...result } = body;
        return JSON.parse(JSON.stringify(result, (key, value) => /password|secret|webhook.?token|api.?key/i.test(key) ? undefined : value));
    }
    return body;
}
async function getEntity(ctx, kind, id) {
    const result = await ctx.db.query("SELECT body FROM campaigns.entities WHERE kind=$1 AND id=$2", [kind, id]);
    if (!result.rows[0])
        throw http(404, "Not found");
    return publicEntity(kind, result.rows[0].body);
}
function restrictedLists(request) {
    if (!request.user || !Object.prototype.hasOwnProperty.call(request.user, "listIds"))
        return null;
    const value = request.user.listIds;
    if (!Array.isArray(value))
        return [];
    return value.map(String);
}
async function installationScope(db) {
    const result = await db.query("SELECT scope::text scope FROM campaigns.installation WHERE singleton=true");
    if (!result.rows[0]?.scope)
        throw http(503, "Installation scope is unavailable");
    return result.rows[0].scope;
}
const ENTITY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function boundedIds(value, label) {
    if (!Array.isArray(value) || value.length > 1000 || value.some(id => typeof id !== "string" || !ENTITY_UUID.test(id))) {
        throw http(400, `${label} must be an array of at most 1000 UUIDs`);
    }
    const ids = [...new Set(value)];
    if (ids.length !== value.length)
        throw http(400, `${label} must contain unique IDs`);
    return ids;
}
async function validateSegmentIds(db, scope, ids) {
    if (!ids.length)
        return;
    const found = await db.query("SELECT id FROM campaigns.audience_segments WHERE scope=$1 AND id=ANY($2::uuid[])", [scope, ids]);
    if (found.rowCount !== ids.length)
        throw http(400, "Unknown segment");
}
async function validateListIds(db, ids) {
    if (!ids.length)
        return;
    const found = await db.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [ids]);
    if (found.rowCount !== ids.length)
        throw http(400, "Unknown list");
}
export async function resolveCampaignAudience(repository, scope, source, allowedListIds, generatedAt = new Date().toISOString()) {
    const included = await createAudienceSnapshot(repository, scope, {
        listIds: source.listIds ?? [], segmentIds: source.segmentIds ?? [],
    }, allowedListIds, generatedAt);
    const excludeListIds = boundedIds(source.excludeListIds ?? [], "excludeListIds");
    const excludeSegmentIds = boundedIds(source.excludeSegmentIds ?? [], "excludeSegmentIds");
    let excluded = new Set();
    if (excludeListIds.length || excludeSegmentIds.length) {
        const snapshot = await createAudienceSnapshot(repository, scope, {
            listIds: excludeListIds, segmentIds: excludeSegmentIds,
        }, allowedListIds, generatedAt);
        excluded = new Set(snapshot.recipientIds);
    }
    const recipients = included.recipients.filter(recipient => !excluded.has(recipient.id));
    return {
        ...included,
        source: { ...included.source, excludeListIds: [...excludeListIds].sort(), excludeSegmentIds: [...excludeSegmentIds].sort() },
        recipients,
        recipientIds: recipients.map(recipient => recipient.id),
    };
}
async function customFieldDefinitions(db, scope) {
    const result = await db.query("SELECT definition FROM campaigns.audience_custom_fields WHERE scope=$1 ORDER BY key", [scope]);
    return validateCustomFieldDefinitions(result.rows.map(row => row.definition));
}
async function validateStoredSegments(db, scope, definitions) {
    const result = await db.query("SELECT predicate FROM campaigns.audience_segments WHERE scope=$1", [scope]);
    for (const row of result.rows)
        compileAudiencePredicate(row.predicate, definitions);
}
function assertListsAllowed(request, listIds) {
    const restricted = restrictedLists(request);
    if (!restricted)
        return;
    if (!Array.isArray(listIds) || listIds.length === 0 || listIds.some(id => !restricted.includes(String(id)))) {
        throw http(403, "Resource is outside your assigned lists");
    }
}
function assertEntityAllowed(request, kind, entity) {
    const restricted = restrictedLists(request);
    if (!restricted)
        return;
    if (kind === "lists") {
        if (!restricted.includes(String(entity.id)))
            throw http(403, "Resource is outside your assigned lists");
        return;
    }
    if (kind === "subscribers" || kind === "campaigns")
        assertListsAllowed(request, entity.listIds);
}
async function refreshListCounts(db) {
    await db.query(`
    UPDATE campaigns.entities list
       SET body=jsonb_set(
         list.body,
         '{subscriberCount}',
         to_jsonb((
           SELECT count(*)::int
             FROM campaigns.entities subscriber
            WHERE subscriber.kind='subscribers'
              AND subscriber.body->'listIds' ? list.id::text
         ))
       ),
       updated_at=list.updated_at
     WHERE list.kind='lists'
  `);
}
function providerCredentials(secret) {
    if (typeof secret !== "string" || !secret)
        return {};
    try {
        const value = JSON.parse(secret);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    catch {
        return { password: secret };
    }
}
function validateProvider(value, secret, hasStoredSecret) {
    const type = String(value.type);
    if (!["smtp", "ses", "mailjet", "smtpcom", "sendgrid", "mailgun", "postmark", "resend", "brevo"].includes(type))
        throw http(400, "Unsupported provider type");
    const hasSecret = (typeof secret === "string" && secret.length > 0) || (secret === undefined && hasStoredSecret);
    const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata : {};
    const credentials = providerCredentials(secret);
    if (type === "smtp") {
        if (typeof value.host !== "string" || !value.host.trim())
            throw http(400, "SMTP host is required");
        if (!Number.isInteger(Number(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535)
            throw http(400, "SMTP port is invalid");
        if (value.enabled === true && value.username && !hasSecret)
            throw http(400, "SMTP password is required");
    }
    else if (type === "ses") {
        if (!String(credentials.region ?? metadata.region ?? "").trim())
            throw http(400, "SES region is required");
        if (!String(credentials.accessKeyId ?? value.username ?? "").trim())
            throw http(400, "SES access key ID is required");
        if (value.enabled === true && !hasSecret)
            throw http(400, "SES secret access key is required");
        if (metadata.snsTopicArns !== undefined && (!Array.isArray(metadata.snsTopicArns) ||
            metadata.snsTopicArns.some(topic => typeof topic !== "string" || !/^arn:aws(?:-[a-z]+)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9-_]{1,256}$/.test(topic)))) {
            throw http(400, "SES SNS topic allowlist is invalid");
        }
    }
    else if (type === "mailjet") {
        if (!String(credentials.apiKey ?? value.username ?? "").trim())
            throw http(400, "Mailjet API key is required");
        if (value.enabled === true && !hasSecret)
            throw http(400, "Mailjet secret key is required");
        if (metadata.transport !== undefined && metadata.transport !== "api" && metadata.transport !== "smtp")
            throw http(400, "Mailjet transport is invalid");
        if (metadata.smtpPort !== undefined && metadata.smtpPort !== 465 && metadata.smtpPort !== 587)
            throw http(400, "Mailjet SMTP port is invalid");
    }
    else if (type === "smtpcom") {
        if (!String(credentials.channel ?? metadata.channel ?? value.username ?? "").trim())
            throw http(400, "SMTP.com channel is required");
        if (value.enabled === true && !hasSecret)
            throw http(400, "SMTP.com API key is required");
    }
    else if (type === "mailgun") {
        if (!String(credentials.domain ?? metadata.domain ?? value.username ?? "").trim())
            throw http(400, "Mailgun domain is required");
        if (metadata.region !== undefined && metadata.region !== "us" && metadata.region !== "eu")
            throw http(400, "Mailgun region is invalid");
        if (value.enabled === true && !hasSecret)
            throw http(400, "Mailgun API key is required");
    }
    else if (type === "postmark") {
        if (value.username !== undefined && value.username !== null && String(value.username).length > 0)
            throw http(400, "Postmark tokens must not be stored in the public username field");
        if (metadata.transport !== undefined && metadata.transport !== "api" && metadata.transport !== "smtp")
            throw http(400, "Postmark transport is invalid");
        if (value.enabled === true && !hasSecret)
            throw http(400, "Postmark server token is required");
    }
    else {
        if (value.enabled === true && !hasSecret)
            throw http(400, `${type === "sendgrid" ? "SendGrid" : type === "resend" ? "Resend" : "Brevo"} API key is required`);
    }
}
function webhookOccurredAt(value) {
    if (typeof value !== "string" && typeof value !== "number")
        return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
function normalizedWebhookEvents(provider, payload) {
    if (provider === "ses") {
        const envelope = json(payload);
        const message = typeof envelope.Message === "string" ? json(JSON.parse(envelope.Message)) : envelope;
        const notification = String(message.notificationType ?? message.eventType ?? "").toLowerCase();
        const mail = message.mail && typeof message.mail === "object" ? message.mail : {};
        const messageId = typeof mail.messageId === "string" ? mail.messageId : undefined;
        const occurredAt = webhookOccurredAt(mail.timestamp ?? message.timestamp);
        const recipients = notification.includes("bounce")
            ? (message.bounce?.bouncedRecipients ?? []).map(item => String(item.emailAddress ?? ""))
            : notification.includes("complaint")
                ? (message.complaint?.complainedRecipients ?? []).map(item => String(item.emailAddress ?? ""))
                : [];
        const bounce = message.bounce && typeof message.bounce === "object" ? message.bounce : {};
        const type = notification.includes("delivery") ? "delivered"
            : notification.includes("bounce") ? String(bounce.bounceType ?? "").toLowerCase() === "transient" ? "soft_bounced" : "bounced"
                : notification.includes("complaint") ? "complained" : "ignored";
        return (recipients.length ? recipients : [undefined]).map((address, index) => {
            const normalizedEmail = address?.toLowerCase();
            return { key: hash(messageId || normalizedEmail ? `${type}:${messageId ?? ""}:${normalizedEmail ?? ""}` : `${JSON.stringify(payload)}:${index}`), type, ...(normalizedEmail ? { email: normalizedEmail } : {}), ...(messageId ? { messageId } : {}), ...(occurredAt ? { occurredAt } : {}) };
        });
    }
    const values = Array.isArray(payload) ? payload : [payload];
    return values.slice(0, 1000).map(value => {
        const item = json(value);
        const rawType = String(item.event ?? item.type ?? item.event_type ?? "").toLowerCase();
        const type = rawType.includes("deliver") ? "delivered"
            : rawType.includes("open") ? "opened"
                : rawType.includes("click") ? "clicked"
                    : rawType.includes("complaint") || rawType.includes("spam") ? "complained"
                        : rawType.includes("soft") || rawType.includes("defer") || rawType.includes("temporary") ? "soft_bounced"
                            : rawType.includes("bounce") || rawType.includes("fail") ? "bounced"
                                : rawType.includes("unsubscribe") ? "unsubscribed" : "ignored";
        const rawEmail = item.email ?? (item.recipient && typeof item.recipient === "object" ? item.recipient.address : undefined);
        const rawMessageId = item.MessageID ?? item.messageId ?? item.message_id ?? item["message-id"];
        const normalizedEmail = typeof rawEmail === "string" ? rawEmail.toLowerCase() : undefined;
        const messageId = rawMessageId != null ? String(rawMessageId) : undefined;
        const occurredAt = webhookOccurredAt(item.timestamp ?? item.time ?? item.event_at ?? item.created_at);
        return { key: hash(messageId || normalizedEmail ? `${type}:${messageId ?? ""}:${normalizedEmail ?? ""}` : JSON.stringify(item)), type, ...(normalizedEmail ? { email: normalizedEmail } : {}), ...(messageId ? { messageId } : {}), ...(occurredAt ? { occurredAt } : {}) };
    });
}
function normalize(kind, input, existing) {
    const now = new Date().toISOString();
    const base = existing ?? { id: randomUUID(), createdAt: now };
    if (kind === "lists") {
        fields(input, ["name", "description", "brandId", "metadata"], existing ? [] : ["name"]);
        return { ...base, ...input, subscriberCount: existing?.subscriberCount ?? 0, updatedAt: now };
    }
    if (kind === "subscribers") {
        fields(input, ["email", "firstName", "lastName", "status", "listIds", "tags", "metadata", "scope"], existing ? [] : ["email", "listIds", "scope"]);
        return { ...base, ...input, email: input.email === undefined ? existing?.email : email(input.email), status: input.status ?? existing?.status ?? "subscribed", listIds: input.listIds ?? existing?.listIds, tags: input.tags === undefined ? existing?.tags ?? [] : subscriberTags(input.tags), confirmedAt: existing?.confirmedAt ?? (input.status === "pending" ? null : now), unsubscribedAt: input.status === "unsubscribed" ? now : existing?.unsubscribedAt ?? null, updatedAt: now };
    }
    if (kind === "campaigns") {
        fields(input, ["name", "subject", "previewText", "fromName", "fromEmail", "replyTo", "listIds", "segmentIds", "excludeListIds", "excludeSegmentIds", "brandId", "mergeMissingPolicy", "templateId", "providerId", "metadata"], existing ? [] : ["name", "subject", "fromName", "fromEmail", "templateId", "providerId"]);
        if (existing && existing.status !== "draft")
            throw http(409, "Queued campaign snapshots are immutable");
        const mergeMissingPolicy = input.mergeMissingPolicy ?? existing?.mergeMissingPolicy ?? "empty";
        if (!["error", "empty", "keep"].includes(String(mergeMissingPolicy)))
            throw http(400, "Invalid mergeMissingPolicy");
        return { ...base, ...input, listIds: input.listIds ?? existing?.listIds ?? [], segmentIds: input.segmentIds ?? existing?.segmentIds ?? [], excludeListIds: input.excludeListIds ?? existing?.excludeListIds ?? [], excludeSegmentIds: input.excludeSegmentIds ?? existing?.excludeSegmentIds ?? [], mergeMissingPolicy, fromEmail: input.fromEmail === undefined ? existing?.fromEmail : email(input.fromEmail), replyTo: input.replyTo === undefined ? existing?.replyTo ?? null : input.replyTo === null ? null : email(input.replyTo), status: existing?.status ?? "draft", scheduledAt: existing?.scheduledAt ?? null, statistics: existing?.statistics ?? { recipients: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complaints: 0, unsubscribed: 0 }, updatedAt: now };
    }
    if (kind === "providers") {
        fields(input, ["name", "type", "enabled", "host", "port", "username", "secret", "metadata"], existing ? [] : ["name", "type", "enabled"]);
        const { secret: _secret, ...safe } = input;
        return { ...base, ...safe, configured: input.secret !== undefined ? !!input.secret : existing?.configured ?? false, updatedAt: now };
    }
    fields(input, ["name", "subject", "html", "text", "brandId", "metadata"], existing ? [] : ["name", "subject", "html"]);
    // text is required by the create contract, but an empty plain-text
    // alternative is valid. validateTemplate separately enforces its type.
    if (!existing && input.text === undefined)
        throw http(400, "Missing field: text");
    return { ...base, ...input, updatedAt: now };
}
async function issueSession(ctx, response, userId) {
    const session = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    await ctx.db.query("INSERT INTO campaigns.sessions(id_hash,user_id,csrf_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+($5||' hours')::interval)", [hash(session), userId, hash(csrf), csrf, String(ctx.sessionHours)]);
    const attrs = [`${COOKIE}=${encodeURIComponent(session)}`, "HttpOnly", "Path=/api/campaigns", "SameSite=Strict", `Max-Age=${ctx.sessionHours * 3600}`];
    if (ctx.secureCookies)
        attrs.push("Secure");
    response.setHeader("Set-Cookie", attrs.join("; "));
    return csrf;
}
async function listRows(ctx, table, request) {
    const p = page(request);
    const search = table === "audit" ? "" : String(request.query.search ?? "").trim().toLowerCase();
    if (search.length > 200)
        throw http(400, "Search must not exceed 200 characters");
    const where = search ? " WHERE lower(concat_ws(' ',body->>'name',body->>'email',body->>'description')) LIKE $3" : "";
    const count = await ctx.db.query(`SELECT count(*)::text count FROM campaigns.${table}${search ? " WHERE lower(concat_ws(' ',body->>'name',body->>'email',body->>'description')) LIKE $1" : ""}`, search ? [`%${search}%`] : []);
    const result = table === "audit"
        ? await ctx.db.query("SELECT jsonb_build_object('id',id,'action',action,'entityType',entity_type,'entityId',entity_id,'actor',CASE WHEN actor IS NULL THEN NULL ELSE jsonb_build_object('id',actor->'id','name',actor->'name') END,'metadata',metadata,'createdAt',created_at) body FROM campaigns.audit ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2", [p.pageSize, p.offset])
        : await ctx.db.query(`SELECT body FROM campaigns.${table}${where} ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`, [p.pageSize, p.offset, ...(search ? [`%${search}%`] : [])]);
    return {
        rows: result.rows.map(r => table === "audit"
            ? { ...r.body, metadata: serializedAuditMetadata(r.body.metadata) }
            : r.body),
        total: Number(count.rows[0]?.count ?? 0),
    };
}
function demoBootstrap(request) {
    return { status: statusData(false, request, false), dashboard: demoDashboard, ...demo };
}
export function createCampaignsRouter(options = {}) {
    const db = options.pool ?? new Pool({ connectionString: options.databaseUrl ?? campaignsDatabaseUrl(), max: 10 });
    const dataDir = options.dataDir ?? process.env.CAMPAIGNS_DATA_DIR ?? join(process.cwd(), ".campaigns-data");
    const ctx = {
        db,
        dataDir,
        key: secureFile(join(dataDir, "credential-key"), 32),
        setupToken: installerToken(dataDir),
        secureCookies: options.secureCookies ?? process.env.NODE_ENV === "production",
        sessionHours: options.sessionHours ?? 12,
        activationRevalidateMs: options.activationRevalidateMs ?? 15 * 60 * 1000,
        bridgeFactory: options.bridgeFactory ?? ((apiKey) => new SendReputeClient({ secret: apiKey })),
        send: options.send ?? sendMessage,
        verify: options.verify ?? verifyProvider,
        ...(options.verifySesWebhookSignature ? { verifySesWebhookSignature: options.verifySesWebhookSignature } : {}),
        telegramSend: options.telegramSend ?? sendTelegramMessage,
        now: options.now ?? (() => new Date()),
        ready: migrate(db),
    };
    // A standalone router can be mounted before its first request. Keep the
    // rejected promise observable by request middleware without letting an
    // early migration failure become a process-level unhandled rejection.
    void ctx.ready.catch(() => undefined);
    const router = Router();
    router.use("/subscribers/import", express.text({ type: "text/csv", limit: MAX_BODY }));
    router.use((request, _response, next) => {
        if (options.trustProxy !== undefined && request.app.get("trust proxy") !== options.trustProxy) {
            request.app.set("trust proxy", options.trustProxy);
        }
        ctx.ready.then(() => loadUser(ctx, request)).then(() => next(), next);
    });
    const audienceRepository = createPostgresAudienceRepository(db);
    const assertSubscriberIdsAllowed = async (request, ids, database = db) => {
        if (!ids.length)
            return;
        if (ids.length > 10_000 || ids.some(id => !ENTITY_UUID.test(id)))
            throw http(400, "Invalid subscriber IDs");
        const rows = await database.query("SELECT id,body FROM campaigns.entities WHERE kind='subscribers' AND id=ANY($1::uuid[]) ORDER BY id", [ids]);
        if (rows.rowCount !== ids.length)
            throw http(404, "One or more subscribers were not found");
        for (const row of rows.rows)
            assertEntityAllowed(request, "subscribers", row.body);
    };
    router.use(createBrandsRouter({
        db, mutation, need, wrap, page, json, fields, http,
        scope: () => installationScope(db),
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    router.use(createHousekeepingRouter({
        db: db, secret: ctx.key, now: ctx.now, mutation, need, wrap, page, json, fields, http,
        scope: () => installationScope(db),
        assertSubscriberIdsAllowed,
        refreshListCounts: database => refreshListCounts((database ?? db)),
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    const enqueueSubscriptionMail = async (event) => {
        const [subscriberResult, templateResult, settingsResult] = await Promise.all([
            db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1", [event.subscriberId]),
            db.query("SELECT body FROM campaigns.entities WHERE kind='templates' AND id=$1", [event.templateId]),
            db.query("SELECT settings FROM campaigns.installation WHERE singleton=true"),
        ]);
        const subscriber = subscriberResult.rows[0]?.body, template = templateResult.rows[0]?.body, settings = settingsResult.rows[0]?.settings;
        if (!subscriber || !template || !settings)
            throw Object.assign(new Error("Subscription mail references are unavailable"), { code: "SUBSCRIPTION_MAIL_REFERENCE" });
        const brand = await getBrandDefaults(db, await installationScope(db), template.brandId);
        const campaign = {
            name: `${event.kind} subscription message`, subject: template.subject,
            fromName: brand?.defaultFromName ?? settings.defaultFromName,
            fromEmail: brand?.defaultFromEmail ?? settings.defaultFromEmail,
            replyTo: brand?.defaultReplyTo ?? null, providerId: event.providerId,
        };
        await db.query(`INSERT INTO campaigns.jobs(id,recipient_id,kind,state,run_at,snapshot)
       VALUES($1,$2,'subscription','queued',now(),$3) ON CONFLICT DO NOTHING`, [event.eventId, event.subscriberId, { campaign, template, subscriber, providerId: event.providerId, subscription: { kind: event.kind, listId: event.listId, eventId: event.eventId }, audience: { scope: subscriber.scope } }]);
    };
    router.use(createRulesWebhooksRouter({
        db, mutation, need, wrap, assertListsAllowed, restrictedLists, key: ctx.key, encrypt: encrypted,
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    router.use(createSubscriptionCustomizationRouter({
        db, mutation, need, wrap,
        assertListAllowed: async (request, listId) => {
            assertListsAllowed(request, [listId]);
            await getEntity(ctx, "lists", listId);
        },
        brandScope: () => installationScope(db),
        verifyListToken: (listId, token) => {
            const expected = subscriptionListToken(ctx.key, listId);
            return token.length === expected.length && equalText(token, expected);
        },
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    const recordTrackingEvent = createPostgresTrackingEventRecorder(db, async (event) => {
        if (!event.jobId)
            return;
        await appendDeliveryEvent(db, {
            jobId: event.jobId, campaignId: event.campaignId, recipientId: event.recipientId,
            type: event.type === "open" ? "provider_opened" : "provider_clicked",
            source: "system", providerEventKey: `tracking:${event.documentId}:${event.type}:${event.key}`,
            occurredAt: event.occurredAt, metadata: { trackingSource: "first_party" },
        });
        if (event.campaignId)
            await refreshCampaignDeliveryStatistics(db, event.campaignId);
    });
    router.use(createDomainsTrackingRouter({
        db, signingKey: ctx.key, now: ctx.now, recordEvent: recordTrackingEvent,
        need, mutation, wrap, page, http,
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    router.use(createProviderAnalyticsRouter({
        db, decrypt: decrypted, credentialKey: ctx.key, mutation, need, wrap, page, http, restrictedLists,
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    router.use("/campaigns/:campaignId", (request, _response, next) => {
        if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
            next();
            return;
        }
        // Do not touch the experiments table before the route's session/CSRF
        // middleware has a chance to reject an anonymous mutation.
        if (!request.user) {
            next(http(401, "Authentication required"));
            return;
        }
        db.query("SELECT 1 FROM campaigns.experiments WHERE campaign_id=$1", [request.params.campaignId])
            .then(found => next(found.rowCount ? http(409, "Campaign is reserved for an immutable experiment") : undefined), next);
    });
    router.get("/audiences/custom-fields", need("audiences:read"), wrap(async (_request, response) => {
        const scope = await installationScope(db);
        response.json({ data: await customFieldDefinitions(db, scope) });
    }));
    router.post("/audiences/custom-fields", mutation, need("audiences:manage"), wrap(async (request, response) => {
        const definition = validateCustomFieldDefinitions([request.body])[0];
        const scope = await installationScope(db);
        const current = await customFieldDefinitions(db, scope);
        const definitions = validateCustomFieldDefinitions([...current, definition]);
        const subscribers = await db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1", [scope]);
        for (const subscriber of subscribers.rows)
            validateCustomValues(subscriber.body.metadata ?? {}, definitions);
        await validateStoredSegments(db, scope, definitions);
        await db.query("INSERT INTO campaigns.audience_custom_fields(scope,key,definition) VALUES($1,$2,$3)", [scope, definition.key, definition]);
        await audit(ctx, request, "audience.custom_field.create", "audience_custom_fields", definition.key);
        response.status(201).json({ data: definition });
    }));
    router.put("/audiences/custom-fields/:key", mutation, need("audiences:manage"), wrap(async (request, response) => {
        const definition = validateCustomFieldDefinitions([request.body])[0];
        const key = String(request.params.key);
        if (definition.key !== key)
            throw http(400, "Custom field key cannot be changed");
        const scope = await installationScope(db);
        const current = (await customFieldDefinitions(db, scope)).filter(item => item.key !== key);
        const definitions = validateCustomFieldDefinitions([...current, definition]);
        const subscribers = await db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1", [scope]);
        for (const subscriber of subscribers.rows)
            validateCustomValues(subscriber.body.metadata ?? {}, definitions);
        await validateStoredSegments(db, scope, definitions);
        const updated = await db.query("UPDATE campaigns.audience_custom_fields SET definition=$3,updated_at=now() WHERE scope=$1 AND key=$2", [scope, key, definition]);
        if (!updated.rowCount)
            throw http(404, "Custom field not found");
        await audit(ctx, request, "audience.custom_field.update", "audience_custom_fields", key);
        response.json({ data: definition });
    }));
    router.delete("/audiences/custom-fields/:key", mutation, need("audiences:manage"), wrap(async (request, response) => {
        const scope = await installationScope(db);
        const key = String(request.params.key);
        const remaining = (await customFieldDefinitions(db, scope)).filter(item => item.key !== key);
        const subscribers = await db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1", [scope]);
        for (const subscriber of subscribers.rows)
            validateCustomValues(subscriber.body.metadata ?? {}, remaining);
        await validateStoredSegments(db, scope, remaining);
        const deleted = await db.query("DELETE FROM campaigns.audience_custom_fields WHERE scope=$1 AND key=$2", [scope, key]);
        if (!deleted.rowCount)
            throw http(404, "Custom field not found");
        await audit(ctx, request, "audience.custom_field.delete", "audience_custom_fields", key);
        response.json({ data: { deleted: true } });
    }));
    router.put("/audiences/custom-fields", mutation, need("audiences:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["definitions"], ["definitions"]);
        const definitions = validateCustomFieldDefinitions(body.definitions);
        const scope = await installationScope(db);
        const subscribers = await db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1", [scope]);
        for (const subscriber of subscribers.rows)
            validateCustomValues(subscriber.body.metadata ?? {}, definitions);
        await validateStoredSegments(db, scope, definitions);
        const client = await db.connect?.();
        if (!client)
            throw http(500, "Audience custom fields require a transaction-capable PostgreSQL pool");
        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM campaigns.audience_custom_fields WHERE scope=$1", [scope]);
            for (const definition of definitions) {
                await client.query("INSERT INTO campaigns.audience_custom_fields(scope,key,definition) VALUES($1,$2,$3)", [scope, definition.key, definition]);
            }
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
        await audit(ctx, request, "audience.custom_fields.replace", "audience_custom_fields", scope, { count: definitions.length });
        response.json({ data: definitions });
    }));
    router.use("/audiences", (request, response, next) => {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method))
            return mutation(request, response, next);
        next();
    }, createAudienceRouter({
        repository: audienceRepository,
        context: async (request) => {
            if (!request.user)
                throw http(401, "Authentication required");
            const effectivePermissions = request.user.permissions.includes("*")
                ? [...request.user.permissions, "audiences:read", "audiences:manage"]
                : request.user.permissions;
            return {
                scope: await installationScope(db),
                principal: { id: request.user.id, permissions: effectivePermissions, listIds: restrictedLists(request) },
            };
        },
        customFields: scope => customFieldDefinitions(db, scope),
    }));
    router.get("/status", wrap(async (request, response) => {
        const isInstalled = await installed(ctx);
        let active = false;
        if (isInstalled) {
            const item = await connection(ctx);
            active = item?.body.connected === true;
        }
        response.json({ data: statusData(isInstalled, request, active) });
    }));
    router.post("/setup", wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["setupToken", "ownerName", "email", "password", "instanceName", "publicUrl", "sendReputeApiKey"], ["setupToken", "ownerName", "email", "password", "instanceName", "publicUrl", "sendReputeApiKey"]);
        if (!ctx.setupToken || !equalText(String(body.setupToken), ctx.setupToken))
            throw http(403, "Invalid installer token");
        const password = validatePassword(body.password);
        const configuredPublicUrl = publicUrl(body.publicUrl);
        let snapshot;
        try {
            snapshot = await ctx.bridgeFactory(String(body.sendReputeApiKey)).getConnectionSnapshot();
        }
        catch (error) {
            throw activationError(error);
        }
        const client = await db.connect?.();
        const tx = client ?? db;
        try {
            await tx.query("BEGIN");
            await tx.query("SELECT pg_advisory_xact_lock(736452901)");
            if ((await tx.query("SELECT 1 FROM campaigns.installation")).rowCount)
                throw http(409, "Campaigns is already installed");
            const createdAt = ctx.now().toISOString();
            const roleIds = {};
            for (const [name, grants] of Object.entries(permissions)) {
                const id = randomUUID();
                roleIds[name] = id;
                const value = { id, name: name[0].toUpperCase() + name.slice(1), description: `${name} system role`, permissions: grants, system: true, createdAt, updatedAt: createdAt };
                await tx.query("INSERT INTO campaigns.roles(id,body,system) VALUES($1,$2,true)", [id, value]);
            }
            const userId = randomUUID();
            const user = { id: userId, name: String(body.ownerName), email: email(body.email), active: true, roleIds: [roleIds.owner], lastLoginAt: createdAt, createdAt, updatedAt: createdAt };
            await tx.query("INSERT INTO campaigns.users(id,email,password_hash,body) VALUES($1,$2,$3,$4)", [userId, user.email, await passwordHash(password), user]);
            const settings = { instanceName: String(body.instanceName), publicUrl: configuredPublicUrl.toString(), defaultFromName: String(body.ownerName), defaultFromEmail: user.email, doubleOptIn: true, trackingEnabled: true, timezone: "UTC", metadata: {} };
            const snapshotData = snapshot;
            const balance = snapshotData.balance;
            const conn = { configured: true, connected: true, apiBaseUrl: PRODUCTION_API_BASE_URL, accountEmail: null, accountId: null, plan: null, balanceMillicents: Number(balance?.availableMillicents ?? 0), lastCheckedAt: createdAt, error: null, snapshot };
            await tx.query("INSERT INTO campaigns.installation(settings,connection_secret,connection) VALUES($1,$2,$3)", [settings, encrypted(ctx.key, String(body.sendReputeApiKey)), conn]);
            await tx.query("COMMIT");
            ctx.setupToken = null;
            try {
                unlinkSync(join(ctx.dataDir, "installer-token"));
            }
            catch { }
            const csrf = await issueSession(ctx, response, userId);
            request.user = { ...user, permissions: [...permissions.owner] };
            request.csrfToken = csrf;
            await audit(ctx, request, "installation.setup", "installation", null);
            response.status(201).json({ data: statusData(true, request, true) });
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
    }));
    router.post("/login", wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["email", "password"], ["email", "password"]);
        // The lookup normalizes case and surrounding whitespace. Rate limiting
        // must use that same identity, or each spelling gets a fresh attempt budget.
        if (typeof body.email !== "string")
            throw http(400, "Invalid email address");
        const normalizedEmail = email(body.email);
        const key = hash(`${request.ip}:${normalizedEmail}`);
        const attempt = await db.query("INSERT INTO campaigns.login_attempts(fingerprint,failures,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(fingerprint) DO UPDATE SET failures=CASE WHEN campaigns.login_attempts.reset_at>now() THEN campaigns.login_attempts.failures+1 ELSE 1 END,reset_at=CASE WHEN campaigns.login_attempts.reset_at>now() THEN campaigns.login_attempts.reset_at ELSE now()+interval '15 minutes' END RETURNING failures", [key]);
        if ((attempt.rows[0]?.failures ?? 1) > 5)
            throw http(429, "Too many login attempts");
        const suppliedPassword = typeof body.password === "string" && body.password.length <= 1024
            ? body.password
            : "";
        const result = await db.query("SELECT id,password_hash,body FROM campaigns.users WHERE email=$1", [normalizedEmail]);
        const row = result.rows[0];
        if (!row || row.body.active === false || !suppliedPassword || !await passwordVerify(row.password_hash, suppliedPassword)) {
            throw http(401, "Invalid email or password");
        }
        await db.query("DELETE FROM campaigns.login_attempts WHERE fingerprint=$1", [key]);
        const csrf = await issueSession(ctx, response, row.id);
        await db.query("UPDATE campaigns.users SET body=body||jsonb_build_object('lastLoginAt',now()),updated_at=now() WHERE id=$1", [row.id]);
        const roleIds = row.body.roleIds;
        const roles = await db.query("SELECT body FROM campaigns.roles WHERE id=ANY($1::uuid[])", [roleIds]);
        const granted = [...new Set(roles.rows.flatMap(role => role.body.permissions ?? []))];
        request.user = { ...row.body, id: row.id, email: String(row.body.email), name: String(row.body.name), roleIds, permissions: granted };
        request.csrfToken = csrf;
        await audit(ctx, request, "session.login", "user", row.id);
        response.json({ data: statusData(true, request, (await connection(ctx))?.body.connected === true) });
    }));
    router.post("/logout", mutation, wrap(async (request, response) => {
        const token = parseCookies(request)[COOKIE];
        if (token)
            await db.query("DELETE FROM campaigns.sessions WHERE id_hash=$1", [hash(token)]);
        response.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/api/campaigns; SameSite=Strict; Max-Age=0`);
        response.status(204).end();
    }));
    router.get("/demo/bootstrap", (_request, response) => response.json({ data: demoBootstrap(_request) }));
    router.get("/dashboard", wrap(async (request, response) => {
        const p = page(request);
        if (request.query.demo === "true")
            return void response.json({ data: { ...demoDashboard, recentActivity: demoDashboard.recentActivity.slice(p.offset, p.offset + p.pageSize), activityMeta: { page: p.page, pageSize: p.pageSize, total: demoDashboard.recentActivity.length } } });
        if (!request.user)
            throw http(401, "Authentication required");
        if (!permitted(request, "read"))
            throw http(403, "Permission denied");
        const allowed = restrictedLists(request);
        const counts = await db.query(`SELECT kind,count(*)::text count FROM campaigns.entities
        WHERE $1::text[] IS NULL
           OR kind NOT IN ('lists','subscribers','campaigns')
           OR kind='lists' AND id=ANY($1::uuid[])
           OR kind IN ('subscribers','campaigns') AND jsonb_array_length(body->'listIds')>0 AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(body->'listIds') assigned(id)
                 WHERE NOT assigned.id=ANY($1::text[])
              )
        GROUP BY kind`, [allowed]);
        const map = Object.fromEntries(counts.rows.map(r => [r.kind, Number(r.count)]));
        const stats = await db.query(`SELECT
         count(DISTINCT de.job_id) FILTER (WHERE de.event_type IN ('accepted','reconciled_accepted'))::text sent,
         count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_delivered')::text delivered,
         count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_opened')::text opened,
         count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_clicked')::text clicked
       FROM campaigns.delivery_events de
       JOIN campaigns.entities e ON e.kind='campaigns' AND e.id=de.campaign_id
       WHERE ($1::text[] IS NULL OR jsonb_array_length(e.body->'listIds')>0 AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(e.body->'listIds') assigned(id)
         WHERE NOT assigned.id=ANY($1::text[])
       ))`, [allowed]);
        const s = stats.rows[0];
        const recent = allowed ? { rows: [] } : await db.query("SELECT jsonb_build_object('id',id,'type',action,'message',action,'actorName',actor->>'name','createdAt',created_at,'metadata',metadata) body FROM campaigns.audit ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2", [p.pageSize, p.offset]);
        const activityTotal = allowed ? 0 : Number((await db.query("SELECT count(*)::text count FROM campaigns.audit")).rows[0]?.count ?? 0);
        response.json({ data: { totals: { lists: map.lists ?? 0, subscribers: map.subscribers ?? 0, campaigns: map.campaigns ?? 0, sent: Number(s.sent), delivered: Number(s.delivered), opened: Number(s.opened), clicked: Number(s.clicked) }, recentActivity: recent.rows.map(r => ({ ...r.body, metadata: serializedAuditMetadata(r.body.metadata) })), activityMeta: { page: p.page, pageSize: p.pageSize, total: activityTotal } } });
    }));
    router.get("/reports/campaign-insights", need("read"), need("api:use"), wrap(async (request, response) => {
        const campaignId = String(request.query.campaignId ?? "");
        assertEntityAllowed(request, "campaigns", await getEntity(ctx, "campaigns", campaignId));
        const item = await connection(ctx);
        if (!item)
            throw http(503, "Not installed");
        const rows = await db.query("SELECT result FROM campaigns.insight_requests WHERE campaign_id=$1 AND user_id=$2 AND credential_hash=$3 AND result IS NOT NULL AND created_at > $4::timestamptz - interval '30 days' ORDER BY created_at DESC LIMIT 10", [campaignId, request.user.id, createHash("sha256").update(item.secret).digest("hex"), ctx.now().toISOString()]);
        response.json({ data: rows.rows.map(row => row.result) });
    }));
    router.post("/reports/campaign-insights/quote", mutation, need("read"), need("api:use"), need("api:spend"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["campaignId", "from", "to", "locale"], ["campaignId"]);
        const locale = body.locale ?? "en";
        if (typeof locale !== "string" || !["en", "ru", "uk", "hi", "de", "fr", "es", "it", "pt", "ar", "id", "tr", "zh", "vi"].includes(locale))
            throw http(400, "Unsupported insight language");
        const campaignId = String(body.campaignId);
        const campaign = await getEntity(ctx, "campaigns", campaignId);
        assertEntityAllowed(request, "campaigns", campaign);
        const from = body.from ? date(body.from) : new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString();
        const to = body.to ? date(body.to) : ctx.now().toISOString();
        const duration = Date.parse(to) - Date.parse(from);
        if (!(duration > 0 && duration <= 366 * 86_400_000))
            throw http(400, "Report range must be positive and at most 366 days");
        const item = await connection(ctx);
        if (!item)
            throw http(503, "Not installed");
        const bridge = ctx.bridgeFactory(item.secret);
        if (!bridge.campaignInsightsQuote)
            throw http(503, "Campaign insights unavailable");
        const events = await db.query("SELECT event_type,count(DISTINCT job_id)::text count FROM campaigns.delivery_events WHERE campaign_id=$1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY event_type", [campaignId, from, to]);
        const keys = { provider_delivered: "delivered", provider_opened: "uniqueOpened", provider_clicked: "uniqueClicked", provider_bounced: "hardBounced", provider_soft_bounced: "softBounced", provider_complained: "complaints", provider_unsubscribed: "unsubscribed" };
        const metrics = {};
        for (const row of events.rows)
            if (keys[row.event_type])
                metrics[keys[row.event_type]] = Number(row.count);
        const sent = await db.query("SELECT count(DISTINCT job_id)::text count FROM campaigns.delivery_events WHERE campaign_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND event_type IN ('accepted','reconciled_accepted')", [campaignId, from, to]);
        metrics.sent = Number(sent.rows[0].count);
        // Missing provider events are omitted, not represented as confirmed zero.
        const quote = await bridge.campaignInsightsQuote();
        const analysisId = randomUUID();
        await cleanupCampaignInsightRetention(db, ctx.now());
        await db.query("INSERT INTO campaigns.insight_requests(id,user_id,campaign_id,credential_hash,metrics,price,locale,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [analysisId, request.user.id, campaignId, createHash("sha256").update(item.secret).digest("hex"), metrics, quote.priceMillicents, locale, ctx.now().toISOString()]);
        response.json({ data: { ...quote, analysisId, metrics, from, to } });
    }));
    router.post("/reports/campaign-insights/analyze", mutation, need("read"), need("api:use"), need("api:spend"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["analysisId", "expectedPriceMillicents", "consent"], ["analysisId", "expectedPriceMillicents", "consent"]);
        if (body.consent !== true)
            throw http(402, "Explicit paid consent is required");
        const item = await connection(ctx);
        if (!item)
            throw http(503, "Not installed");
        const stored = await db.query("SELECT campaign_id,metrics,price,locale FROM campaigns.insight_requests WHERE id=$1 AND user_id=$2 AND credential_hash=$3 AND created_at > $4::timestamptz - interval '30 days'", [body.analysisId, request.user.id, createHash("sha256").update(item.secret).digest("hex"), ctx.now().toISOString()]);
        const row = stored.rows[0];
        if (!row)
            throw http(404, "Insight quote expired or unavailable", "INSIGHT_QUOTE_EXPIRED");
        assertEntityAllowed(request, "campaigns", await getEntity(ctx, "campaigns", row.campaign_id));
        if (body.expectedPriceMillicents !== row.price)
            throw http(409, "Price consent does not match quote");
        const bridge = ctx.bridgeFactory(item.secret);
        if (!bridge.campaignInsightsAnalyze)
            throw http(503, "Campaign insights unavailable");
        const result = await bridge.campaignInsightsAnalyze({ analysisId: String(body.analysisId), expectedPriceMillicents: row.price, consent: true, metrics: row.metrics, locale: row.locale });
        await db.query("UPDATE campaigns.insight_requests SET result=$2 WHERE id=$1", [body.analysisId, result]);
        response.json({ data: result });
    }));
    router.get("/reports/overview", need("read"), wrap(async (request, response) => {
        const campaignId = request.query.campaignId ? String(request.query.campaignId) : null;
        const from = request.query.from ? date(request.query.from) : new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString();
        const to = request.query.to ? date(request.query.to) : ctx.now().toISOString();
        if (new Date(to).getTime() <= new Date(from).getTime() || new Date(to).getTime() - new Date(from).getTime() > 366 * 86_400_000)
            throw http(400, "Report range must be positive and at most 366 days");
        if (campaignId) {
            const campaign = await getEntity(ctx, "campaigns", campaignId);
            assertEntityAllowed(request, "campaigns", campaign);
        }
        const allowed = restrictedLists(request);
        const result = await db.query(`SELECT
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type IN ('accepted','reconciled_accepted'))::text sent,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_delivered')::text delivered,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_opened')::text opened,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_clicked')::text clicked,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_bounced')::text hard_bounced,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_soft_bounced')::text soft_bounced,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_complained')::text complaints,
        count(DISTINCT de.job_id) FILTER (WHERE de.event_type='provider_unsubscribed')::text unsubscribed
       FROM campaigns.delivery_events de
       JOIN campaigns.entities e ON e.kind='campaigns' AND e.id=de.campaign_id
       WHERE de.occurred_at >= $1 AND de.occurred_at < $2
         AND ($3::uuid IS NULL OR de.campaign_id=$3)
         AND ($4::text[] IS NULL OR jsonb_array_length(e.body->'listIds')>0 AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(e.body->'listIds') assigned(id)
           WHERE NOT assigned.id=ANY($4::text[])
         ))`, [from, to, campaignId, allowed]);
        const row = result.rows[0];
        const counts = {
            sent: Number(row.sent), delivered: Number(row.delivered), opened: Number(row.opened), clicked: Number(row.clicked),
            hardBounced: Number(row.hard_bounced), softBounced: Number(row.soft_bounced),
            complaints: Number(row.complaints), unsubscribed: Number(row.unsubscribed),
        };
        const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
        const countries = await db.query(`SELECT upper(de.metadata->>'country') country,count(DISTINCT de.job_id)::text count
       FROM campaigns.delivery_events de
       JOIN campaigns.entities e ON e.kind='campaigns' AND e.id=de.campaign_id
       WHERE de.occurred_at >= $1 AND de.occurred_at < $2 AND ($3::uuid IS NULL OR de.campaign_id=$3)
         AND de.source='provider' AND de.metadata->>'locationTrusted'='true'
         AND de.metadata->>'country' ~ '^[A-Za-z]{2}$'
         AND ($4::text[] IS NULL OR jsonb_array_length(e.body->'listIds')>0 AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(e.body->'listIds') assigned(id) WHERE NOT assigned.id=ANY($4::text[])))
       GROUP BY upper(de.metadata->>'country') ORDER BY count(DISTINCT de.job_id) DESC,upper(de.metadata->>'country') LIMIT 250`, [from, to, campaignId, allowed]);
        response.json({ data: {
                campaignId, from, to, counts,
                rates: { delivery: rate(counts.delivered, counts.sent), open: rate(counts.opened, counts.delivered), click: rate(counts.clicked, counts.delivered), complaint: rate(counts.complaints, counts.delivered) },
                location: countries.rows.length ? { source: "provider", countries: countries.rows.map(item => ({ code: item.country, count: Number(item.count) })) } : { source: "unknown", countries: null },
            } });
    }));
    router.post("/subscribers/import", mutation, need("subscribers:manage"), wrap(async (request, response) => {
        const listId = String(request.query.listId ?? "");
        assertListsAllowed(request, [listId]);
        if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='lists' AND id=$1", [listId])).rowCount)
            throw http(400, "Unknown list");
        const rows = csvRows(typeof request.body === "string" ? request.body : Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "");
        const headers = rows.shift()?.map(v => v.trim().toLowerCase()) ?? [];
        if (!headers.includes("email"))
            throw http(400, "CSV requires an email header");
        let created = 0, updated = 0, skipped = 0;
        const errors = [];
        const scope = await installationScope(db);
        const definitions = await customFieldDefinitions(db, scope);
        for (const [index, values] of rows.entries()) {
            try {
                const record = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
                const address = email(record.email);
                const action = await subscriberTransaction(db, async (tx) => {
                    const old = await scopedSubscriber(tx, scope, address);
                    if (old) {
                        assertEntityAllowed(request, "subscribers", old);
                        const listIds = [...new Set([...(old.listIds ?? []), listId])];
                        const value = normalize("subscribers", { firstName: record.firstname || old.firstName, lastName: record.lastname || old.lastName, listIds, scope, metadata: validateCustomValues(old.metadata ?? {}, definitions) }, old);
                        await tx.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='subscribers' AND id=$2", [value, value.id]);
                        return "updated";
                    }
                    const value = normalize("subscribers", { email: address, firstName: record.firstname || null, lastName: record.lastname || null, listIds: [listId], scope, metadata: validateCustomValues({}, definitions) });
                    await tx.query("INSERT INTO campaigns.entities(kind,id,body) VALUES('subscribers',$1,$2)", [value.id, value]);
                    return "created";
                });
                if (action === "created")
                    created++;
                else
                    updated++;
            }
            catch (error) {
                skipped++;
                if (errors.length < 100)
                    errors.push(`Row ${index + 2}: ${error.message}`);
            }
        }
        await refreshListCounts(db);
        await audit(ctx, request, "subscriber.import", "subscribers", null, { processed: rows.length, created, updated, skipped });
        response.json({ data: { processed: rows.length, created, updated, skipped, errors } });
    }));
    router.get("/subscribers/export", need("subscribers:export"), wrap(async (request, response) => {
        const listId = request.query.listId ? String(request.query.listId) : null;
        if (listId)
            assertListsAllowed(request, [listId]);
        const restricted = restrictedLists(request);
        const result = await db.query(`SELECT body FROM campaigns.entities
        WHERE kind='subscribers'
          ${listId ? "AND body->'listIds' ? $1" : ""}
          ${restricted ? `AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(body->'listIds') assigned(id)
             WHERE NOT assigned.id=ANY($${listId ? 2 : 1}::text[])
          ) AND jsonb_array_length(body->'listIds')>0` : ""}
        ORDER BY body->>'email'`, [...(listId ? [listId] : []), ...(restricted ? [restricted] : [])]);
        const csv = ["email,firstName,lastName,status,listIds", ...result.rows.map(({ body }) => [body.email, body.firstName, body.lastName, body.status, body.listIds.join("|")].map(csvCell).join(","))].join("\r\n");
        response.type("text/csv").setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
        response.send(csv);
    }));
    router.post("/subscribers/batch-delete", mutation, need("subscribers:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["subscriberIds", "confirmation"], ["subscriberIds", "confirmation"]);
        if (body.confirmation !== "DELETE_SUBSCRIBERS")
            throw http(400, "Invalid confirmation");
        const subscriberIds = boundedIds(body.subscriberIds, "subscriberIds");
        if (!subscriberIds.length || subscriberIds.length > 500)
            throw http(400, "subscriberIds must contain 1-500 UUIDs");
        const client = await db.connect?.(), tx = client ?? db;
        let cancelledJobs = 0;
        try {
            await tx.query("BEGIN");
            await assertSubscriberIdsAllowed(request, subscriberIds, tx);
            const blocked = await tx.query("SELECT state,count(*)::text count FROM campaigns.jobs WHERE recipient_id=ANY($1::uuid[]) AND state IN ('sending','sent','unknown') GROUP BY state ORDER BY state", [subscriberIds]);
            if (blocked.rowCount)
                throw http(409, `Subscribers have non-cancellable delivery jobs (${blocked.rows.map(row => `${row.state}:${row.count}`).join(", ")})`);
            cancelledJobs = await cancelQueuedSubscriberJobs(tx, subscriberIds, request.user.id, "subscriber_batch_delete");
            await tx.query("DELETE FROM campaigns.tokens WHERE subscriber_id=ANY($1::uuid[])", [subscriberIds]);
            const deleted = await tx.query("DELETE FROM campaigns.entities WHERE kind='subscribers' AND id=ANY($1::uuid[])", [subscriberIds]);
            if (deleted.rowCount !== subscriberIds.length)
                throw http(409, "Subscriber set changed; retry");
            await refreshListCounts(tx);
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        await audit(ctx, request, "subscriber.batch_delete", "subscribers", null, { deleted: subscriberIds.length, cancelledJobs });
        response.json({ data: { deleted: subscriberIds.length, cancelledJobs } });
    }));
    for (const kind of KINDS) {
        const singular = kind === "campaigns" ? "campaign" : kind.slice(0, -1);
        const manage = `${kind}:manage`;
        router.get(`/${kind}`, wrap(async (request, response) => {
            if (request.query.demo === "true") {
                const search = String(request.query.search ?? "").trim().toLowerCase();
                if (search.length > 200)
                    throw http(400, "Search must not exceed 200 characters");
                const values = demo[kind].filter(value => !search || `${value.name ?? ""} ${value.email ?? ""} ${value.firstName ?? ""} ${value.lastName ?? ""} ${value.subject ?? ""}`.toLowerCase().includes(search)), p = page(request);
                return void response.json({ data: values.slice(p.offset, p.offset + p.pageSize), meta: { page: p.page, pageSize: p.pageSize, total: values.length } });
            }
            if (!request.user)
                throw http(401, "Authentication required");
            if (!permitted(request, "read"))
                throw http(403, "Permission denied");
            const p = page(request);
            const listId = kind === "subscribers" && request.query.listId ? String(request.query.listId) : null;
            const brandId = (kind === "lists" || kind === "templates" || kind === "campaigns") && request.query.brandId ? String(request.query.brandId) : null;
            const search = String(request.query.search ?? "").trim().toLowerCase();
            if (search.length > 200)
                throw http(400, "Search must not exceed 200 characters");
            if (listId)
                assertListsAllowed(request, [listId]);
            if (brandId)
                await getBrandDefaults(db, await installationScope(db), brandId);
            const allowed = restrictedLists(request);
            const scopedKind = kind === "lists" || kind === "subscribers" || kind === "campaigns";
            const clauses = ["kind=$1"];
            const filterArgs = [];
            const add = (value) => { filterArgs.push(value); return 3 + filterArgs.length; };
            if (listId)
                clauses.push(`body->'listIds' ? $${add(listId)}`);
            if (allowed && scopedKind) {
                const at = add(allowed);
                clauses.push(kind === "lists"
                    ? `id=ANY($${at}::uuid[])`
                    : `jsonb_array_length(body->'listIds')>0 AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(body->'listIds') assigned(id)
               WHERE NOT assigned.id=ANY($${at}::text[])
            )`);
            }
            if (brandId)
                clauses.push(`body->>'brandId'=$${add(brandId)}`);
            if (search)
                clauses.push(`lower(concat_ws(' ',body->>'name',body->>'email',body->>'firstName',body->>'lastName',body->>'subject')) LIKE $${add(`%${search}%`)}`);
            const where = clauses.join(" AND ");
            const args = [kind, p.pageSize, p.offset, ...filterArgs];
            const rows = await db.query(`SELECT body FROM campaigns.entities WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3`, args);
            const countWhere = where.replace(/\$(\d+)/g, (_match, value) => `$${Number(value) > 1 ? Number(value) - 2 : value}`);
            const countArgs = [kind, ...filterArgs];
            const total = await db.query(`SELECT count(*)::text count FROM campaigns.entities WHERE ${countWhere}`, countArgs);
            response.json({ data: rows.rows.map(r => publicEntity(kind, r.body)), meta: { page: p.page, pageSize: p.pageSize, total: Number(total.rows[0]?.count ?? 0) } });
        }));
        router.post(`/${kind}`, mutation, need(manage), wrap(async (request, response) => {
            let input = json(request.body);
            if (kind === "subscribers" && Object.prototype.hasOwnProperty.call(input, "scope"))
                throw http(400, "Unknown field: scope");
            if (kind === "lists" || kind === "templates" || kind === "campaigns") {
                const brand = await getBrandDefaults(db, await installationScope(db), input.brandId);
                if (kind === "campaigns" && brand)
                    input = {
                        ...input,
                        fromName: input.fromName ?? brand.defaultFromName,
                        fromEmail: input.fromEmail ?? brand.defaultFromEmail,
                        replyTo: input.replyTo === undefined ? brand.defaultReplyTo ?? null : input.replyTo,
                    };
            }
            const scopedInput = kind === "subscribers" ? { ...input, scope: await installationScope(db) } : input;
            if (kind === "subscribers")
                scopedInput.metadata = validateCustomValues(scopedInput.metadata ?? {}, await customFieldDefinitions(db, String(scopedInput.scope)));
            const value = normalize(kind, scopedInput);
            if (kind === "subscribers" || kind === "campaigns") {
                if (!Array.isArray(value.listIds) || new Set(value.listIds.map(String)).size !== value.listIds.length)
                    throw http(400, "listIds must contain unique list IDs");
                if (kind === "subscribers" && value.listIds.length === 0)
                    throw http(400, "Subscriber listIds must not be empty");
                const ids = value.listIds.map(String);
                value.listIds = ids;
                assertListsAllowed(request, ids);
                const found = await db.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [ids]);
                if (found.rowCount !== ids.length)
                    throw http(400, "Unknown list");
            }
            if (kind === "campaigns") {
                value.segmentIds = boundedIds(value.segmentIds, "segmentIds");
                value.excludeListIds = boundedIds(value.excludeListIds, "excludeListIds");
                value.excludeSegmentIds = boundedIds(value.excludeSegmentIds, "excludeSegmentIds");
                if (!value.listIds.length && !value.segmentIds.length)
                    throw http(400, "Campaign requires unique listIds and/or segmentIds");
                if (value.excludeListIds.length)
                    assertListsAllowed(request, value.excludeListIds);
                await validateListIds(db, value.excludeListIds);
                await validateSegmentIds(db, await installationScope(db), [...value.segmentIds, ...value.excludeSegmentIds]);
                if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='templates' AND id=$1", [value.templateId])).rowCount)
                    throw http(400, "Unknown template");
                if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='providers' AND id=$1", [value.providerId])).rowCount)
                    throw http(400, "Unknown provider");
            }
            if (kind === "providers")
                validateProvider(value, input.secret, false);
            if (kind === "templates")
                validateTemplate(value);
            const secret = kind === "providers" && input.secret ? encrypted(ctx.key, String(input.secret)) : null;
            if (kind === "subscribers") {
                await subscriberTransaction(db, async (tx) => {
                    if (await scopedSubscriber(tx, String(value.scope), String(value.email)))
                        throw http(409, "Subscriber email already exists");
                    await tx.query("INSERT INTO campaigns.entities(kind,id,body,secret) VALUES($1,$2,$3,$4)", [kind, value.id, value, secret]);
                    await refreshListCounts(tx);
                    for (const listId of value.listIds)
                        await recordRuleEvent(tx, {
                            eventId: `subscriber:${String(value.id)}:list:${listId}:created`, type: "list.joined",
                            subscriberId: String(value.id), listId,
                        });
                });
            }
            else {
                await db.query("INSERT INTO campaigns.entities(kind,id,body,secret) VALUES($1,$2,$3,$4)", [kind, value.id, value, secret]);
            }
            await audit(ctx, request, `${singular}.create`, kind, String(value.id));
            response.status(201).json({ data: value });
        }));
        router.get(`/${kind}/:${singular}Id`, wrap(async (request, response) => {
            const id = String(request.params[`${singular}Id`]);
            if (request.query.demo === "true") {
                const value = demo[kind].find(item => item.id === id);
                if (!value)
                    throw http(404, "Demo resource not found");
                response.json({ data: value });
                return;
            }
            if (!request.user)
                throw http(401, "Authentication required");
            if (!permitted(request, "read"))
                throw http(403, "Permission denied");
            const value = await getEntity(ctx, kind, id);
            assertEntityAllowed(request, kind, value);
            response.json({ data: value });
        }));
        router.patch(`/${kind}/:${singular}Id`, mutation, need(manage), wrap(async (request, response) => {
            const id = String(request.params[`${singular}Id`]), input = json(request.body);
            if (kind === "subscribers") {
                if (!Object.keys(input).length)
                    throw http(400, "Patch must not be empty");
                if (Object.prototype.hasOwnProperty.call(input, "scope"))
                    throw http(400, "Unknown field: scope");
                const definitions = await customFieldDefinitions(db, await installationScope(db));
                const value = await subscriberTransaction(db, async (tx) => {
                    const found = await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1 FOR UPDATE", [id]);
                    const old = found.rows[0]?.body;
                    if (!old)
                        throw http(404, "Subscriber not found");
                    assertEntityAllowed(request, "subscribers", old);
                    const scope = String(old.scope);
                    const metadata = validateCustomValues(input.metadata ?? old.metadata ?? {}, definitions);
                    const updated = normalize("subscribers", { ...input, scope, metadata }, old);
                    if (!Array.isArray(updated.listIds) || !updated.listIds.length || new Set(updated.listIds.map(String)).size !== updated.listIds.length)
                        throw http(400, "Subscriber listIds must contain unique list IDs");
                    updated.listIds = updated.listIds.map(String);
                    assertListsAllowed(request, updated.listIds);
                    const lists = await tx.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [updated.listIds]);
                    if (lists.rowCount !== updated.listIds.length)
                        throw http(400, "Unknown list");
                    const collision = await scopedSubscriber(tx, scope, String(updated.email));
                    if (collision && collision.id !== id)
                        throw http(409, "Subscriber email already exists");
                    await tx.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='subscribers' AND id=$2 AND body->>'scope'=$3", [updated, id, scope]);
                    await refreshListCounts(tx);
                    const prior = new Set(old.listIds ?? []);
                    for (const listId of updated.listIds.filter(listId => !prior.has(listId)))
                        await recordRuleEvent(tx, {
                            eventId: `subscriber:${id}:list:${listId}:${String(updated.updatedAt)}`, type: "list.joined",
                            subscriberId: id, listId,
                        });
                    return updated;
                });
                await audit(ctx, request, `${singular}.update`, kind, id);
                response.json({ data: value });
                return;
            }
            const existing = await getEntity(ctx, kind, id);
            assertEntityAllowed(request, kind, existing);
            if (!Object.keys(input).length)
                throw http(400, "Patch must not be empty");
            if (kind === "lists" || kind === "templates" || kind === "campaigns")
                await getBrandDefaults(db, await installationScope(db), input.brandId === undefined ? existing.brandId : input.brandId);
            const value = normalize(kind, input, existing);
            if (kind === "campaigns") {
                if (!Array.isArray(value.listIds) || new Set(value.listIds.map(String)).size !== value.listIds.length)
                    throw http(400, "listIds must contain unique list IDs");
                const listIds = value.listIds.map(String);
                value.listIds = listIds;
                assertListsAllowed(request, listIds);
                const found = await db.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [listIds]);
                if (found.rowCount !== listIds.length)
                    throw http(400, "Unknown list");
            }
            if (kind === "campaigns") {
                const ids = value.listIds;
                value.segmentIds = boundedIds(value.segmentIds, "segmentIds");
                value.excludeListIds = boundedIds(value.excludeListIds, "excludeListIds");
                value.excludeSegmentIds = boundedIds(value.excludeSegmentIds, "excludeSegmentIds");
                if (!ids.length && !value.segmentIds.length)
                    throw http(400, "Campaign requires unique listIds and/or segmentIds");
                if (value.excludeListIds.length)
                    assertListsAllowed(request, value.excludeListIds);
                await validateListIds(db, value.excludeListIds);
                await validateSegmentIds(db, await installationScope(db), [...value.segmentIds, ...value.excludeSegmentIds]);
                if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='templates' AND id=$1", [value.templateId])).rowCount)
                    throw http(400, "Unknown template");
                if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='providers' AND id=$1", [value.providerId])).rowCount)
                    throw http(400, "Unknown provider");
            }
            if (kind === "providers") {
                const stored = await db.query("SELECT 1 FROM campaigns.entities WHERE kind='providers' AND id=$1 AND secret IS NOT NULL", [id]);
                validateProvider(value, input.secret, !!stored.rowCount);
            }
            if (kind === "templates")
                validateTemplate(value);
            const secret = kind === "providers" && input.secret !== undefined ? input.secret ? encrypted(ctx.key, String(input.secret)) : null : undefined;
            await db.query(secret === undefined ? "UPDATE campaigns.entities SET body=$3,updated_at=now() WHERE kind=$1 AND id=$2" : "UPDATE campaigns.entities SET body=$3,secret=$4,updated_at=now() WHERE kind=$1 AND id=$2", secret === undefined ? [kind, id, value] : [kind, id, value, secret]);
            await audit(ctx, request, `${singular}.update`, kind, id);
            response.json({ data: value });
        }));
        router.delete(`/${kind}/:${singular}Id`, mutation, need(manage), wrap(async (request, response) => {
            const id = String(request.params[`${singular}Id`]);
            const existing = await getEntity(ctx, kind, id);
            assertEntityAllowed(request, kind, existing);
            const result = await db.query("DELETE FROM campaigns.entities WHERE kind=$1 AND id=$2", [kind, id]);
            if (!result.rowCount)
                throw http(404, "Not found");
            if (kind === "subscribers")
                await refreshListCounts(db);
            await audit(ctx, request, `${singular}.delete`, kind, id);
            response.status(204).end();
        }));
    }
    router.post("/providers/:providerId/verify", mutation, need("providers:manage"), wrap(async (request, response) => {
        const id = String(request.params.providerId);
        const result = await db.query("SELECT body,secret FROM campaigns.entities WHERE kind='providers' AND id=$1", [id]);
        const row = result.rows[0];
        if (!row)
            throw http(404, "Provider not found");
        if (!row.secret)
            throw http(409, "Provider credentials are not configured");
        validateProvider(row.body, undefined, true);
        try {
            const verification = await ctx.verify(deliveryConfig(row.body, decrypted(ctx.key, row.secret)));
            await audit(ctx, request, "provider.verify", "providers", id, { ok: true });
            response.json({ data: { ok: true, id, message: verification.verification === "inconclusive" ? "Provider credentials could not be conclusively verified with this key's read scope" : "Provider verified", ...(verification.verification ? { verification: verification.verification } : {}) } });
        }
        catch (error) {
            await audit(ctx, request, "provider.verify", "providers", id, { ok: false, code: error.code ?? "VERIFICATION_FAILED" });
            throw http(502, "Provider verification failed");
        }
    }));
    router.post("/hosted-builder/launch", mutation, need("templates:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["state", "initialMjml", "mode", "vipAccessId", "initialDocument"], ["state"]);
        if (typeof body.state !== "string" || !/^[a-f0-9]{64}$/.test(body.state) ||
            (body.mode !== undefined && body.mode !== "standard" && body.mode !== "vip") ||
            (body.initialMjml !== undefined && (typeof body.initialMjml !== "string" || Buffer.byteLength(body.initialMjml) > 512 * 1024)) ||
            (body.mode === "vip" && (typeof body.vipAccessId !== "string" || !body.initialDocument)) ||
            (body.initialDocument !== undefined && Buffer.byteLength(JSON.stringify(body.initialDocument)) > 512 * 1024)) {
            throw http(400, "Invalid hosted builder launch");
        }
        // A hosted launch is a sensitive boundary. Always revalidate centrally;
        // the handoff endpoint remains authoritative for VIP/access ownership.
        await validActivation(ctx, true);
        const item = await connection(ctx);
        if (!item)
            throw http(503, "SendRepute connection is not configured");
        const bridge = ctx.bridgeFactory(item.secret);
        if (!bridge.createHostedBuilderHandoff)
            throw http(503, "Hosted builder handoff is unavailable");
        const installation = await db.query("SELECT settings FROM campaigns.installation");
        const configuredUrl = new URL(String(installation.rows[0]?.settings.publicUrl ?? ""));
        const returnOrigin = configuredUrl.origin;
        const launchInput = {
            state: body.state,
            returnOrigin,
            ...(body.initialMjml === undefined ? {} : { initialMjml: body.initialMjml }),
            ...(body.mode === undefined ? {} : { mode: body.mode }),
            ...(body.vipAccessId === undefined ? {} : { vipAccessId: String(body.vipAccessId) }),
            ...(body.initialDocument === undefined ? {} : { initialDocument: json(body.initialDocument) }),
        };
        const launch = assertHostedBuilderLaunch(await bridge.createHostedBuilderHandoff(launchInput), String(body.state));
        await audit(ctx, request, "hosted_builder.launch", "templates", null);
        response.status(201).json({ data: launch });
    }));
    router.post("/webhooks/:providerId", wrap(async (request, response) => {
        const id = String(request.params.providerId);
        const result = await db.query("SELECT body,secret FROM campaigns.entities WHERE kind='providers' AND id=$1 AND body->>'enabled'='true'", [id]);
        const row = result.rows[0];
        if (!row?.secret)
            throw http(401, "Invalid webhook authentication");
        const raw = JSON.stringify(request.body);
        if (Buffer.byteLength(raw) > 1_048_576)
            throw http(413, "Webhook body is too large");
        const type = String(row.body.type);
        let payload;
        if (type === "mailjet" || type === "smtpcom") {
            const bearer = request.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? "";
            const credentials = providerCredentials(decrypted(ctx.key, row.secret));
            const expected = String(credentials.webhookToken ?? "");
            try {
                payload = parseTokenWebhook(type, raw, bearer, expected);
            }
            catch {
                throw http(401, "Invalid webhook authentication");
            }
        }
        else if (type === "ses") {
            const metadata = row.body.metadata && typeof row.body.metadata === "object" && !Array.isArray(row.body.metadata) ? row.body.metadata : {};
            const expectedTopicArns = Array.isArray(metadata.snsTopicArns)
                ? metadata.snsTopicArns.filter((topic) => typeof topic === "string")
                : [];
            if (!expectedTopicArns.length)
                throw http(503, "SES SNS topic allowlist is not configured");
            try {
                payload = await parseSesSnsWebhook(raw, {
                    expectedTopicArns,
                    ...(ctx.verifySesWebhookSignature ? { verifySignature: ctx.verifySesWebhookSignature } : {}),
                });
            }
            catch {
                throw http(401, "Invalid webhook signature");
            }
            const envelope = payload;
            if (envelope.Type === "SubscriptionConfirmation" || envelope.Type === "UnsubscribeConfirmation") {
                response.status(202).json({ data: {
                        accepted: 0,
                        confirmationRequired: envelope.Type === "SubscriptionConfirmation",
                        topicArn: envelope.TopicArn,
                        token: envelope.Type === "SubscriptionConfirmation" ? envelope.Token : undefined,
                    } });
                return;
            }
        }
        else {
            throw http(400, "This provider type does not support authenticated webhooks");
        }
        let accepted = 0;
        for (const event of normalizedWebhookEvents(type, payload)) {
            const inserted = await db.query("INSERT INTO campaigns.webhook_events(provider_id,event_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_key", [id, event.key]);
            if (!inserted.rowCount)
                continue;
            accepted++;
            const job = await db.query(`SELECT id,campaign_id,recipient_id,attempt_count,kind
           FROM campaigns.jobs
          WHERE snapshot->'campaign'->>'providerId'=$1
            AND state='sent'
            AND $2::text IS NOT NULL
            AND provider_message_id=$2
          ORDER BY created_at DESC LIMIT 1`, [id, event.messageId ?? null]);
            const matched = job.rows[0];
            if (matched?.kind === "campaign" && matched.recipient_id &&
                (event.type === "bounced" || event.type === "complained" || event.type === "unsubscribed") && event.email) {
                const status = event.type === "bounced" ? "bounced" : event.type === "complained" ? "complained" : "unsubscribed";
                // Provider message IDs bind suppression to the frozen job recipient.
                // Never let a mismatched email in an otherwise authenticated webhook
                // suppress a different subscriber.
                await db.query("UPDATE campaigns.entities SET body=body||jsonb_build_object('status',$3::text,'unsubscribedAt',CASE WHEN $3='unsubscribed' THEN to_jsonb(now()) ELSE body->'unsubscribedAt' END,'updatedAt',now()),updated_at=now() WHERE kind='subscribers' AND id=campaigns.reconciled_subscriber_id($1::uuid) AND lower(btrim(body->>'email'))=lower(btrim($2))", [matched.recipient_id, event.email, status]);
            }
            if (matched && event.type !== "ignored") {
                const deliveryEventId = `${id}:${event.key}`;
                const recorded = await appendDeliveryEvent(db, {
                    jobId: matched.id, campaignId: matched.campaign_id, recipientId: matched.recipient_id,
                    type: `provider_${event.type}`,
                    source: "provider", attempt: matched.attempt_count > 0 ? matched.attempt_count : null, providerMessageId: event.messageId,
                    providerEventKey: deliveryEventId, metadata: event.email ? { email: event.email } : {},
                    occurredAt: event.occurredAt,
                });
                if (matched.kind === "campaign" && matched.campaign_id)
                    await refreshCampaignDeliveryStatistics(db, matched.campaign_id);
                if (recorded && matched.kind === "campaign" && matched.campaign_id && (event.type === "opened" || event.type === "clicked")) {
                    const campaignResult = await db.query("SELECT body FROM campaigns.entities WHERE kind='campaigns' AND id=$1", [matched.campaign_id]);
                    const campaignName = String(campaignResult.rows[0]?.body.name ?? matched.campaign_id);
                    await enqueueCampaignNotification(db, {
                        campaignId: matched.campaign_id,
                        type: event.type,
                        dedupeKey: `provider:${deliveryEventId}`,
                        campaignName,
                        text: `Campaign "${campaignName}" recorded an authenticated provider ${event.type} event.`,
                    });
                }
            }
        }
        if (accepted)
            await refreshListCounts(db);
        response.status(202).json({ data: { ok: true, id, message: `${accepted} new event(s) accepted` } });
    }));
    const campaignAction = (action) => wrap(async (request, response) => {
        const id = String(request.params.campaignId), campaign = await getEntity(ctx, "campaigns", id);
        assertEntityAllowed(request, "campaigns", campaign);
        const nextStatus = action === "pause" ? "paused" : action === "resume" ? "sending" : "cancelled";
        if (action === "pause" && !["scheduled", "sending"].includes(String(campaign.status)))
            throw http(409, "Campaign cannot be paused");
        if (action === "resume" && campaign.status !== "paused")
            throw http(409, "Campaign is not paused");
        if (action === "cancel" && ["sent", "cancelled"].includes(String(campaign.status)))
            throw http(409, "Campaign cannot be cancelled");
        campaign.status = nextStatus;
        campaign.updatedAt = ctx.now().toISOString();
        await db.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='campaigns' AND id=$2", [campaign, id]);
        if (action === "cancel") {
            const cancelled = await db.query("UPDATE campaigns.jobs SET state='cancelled',updated_at=now(),revision=revision+1 WHERE campaign_id=$1 AND kind='campaign' AND state='queued' RETURNING id,recipient_id", [id]);
            for (const job of cancelled.rows) {
                await appendDeliveryEvent(db, {
                    jobId: job.id, campaignId: id, recipientId: job.recipient_id,
                    type: "cancelled", source: "operator", actorId: request.user.id,
                    metadata: { reason: "campaign_cancelled" },
                });
            }
        }
        await audit(ctx, request, `campaign.${action}`, "campaigns", id);
        response.json({ data: campaign });
    });
    router.post("/campaigns/:campaignId/schedule", mutation, need("campaigns:send"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["scheduledAt"], ["scheduledAt"]);
        const id = String(request.params.campaignId), campaign = await getEntity(ctx, "campaigns", id);
        assertEntityAllowed(request, "campaigns", campaign);
        if (campaign.status !== "draft")
            throw http(409, "Only draft campaigns can be scheduled");
        const scheduledAt = date(body.scheduledAt);
        if (new Date(scheduledAt) <= ctx.now())
            throw http(400, "Scheduled time must be in the future");
        campaign.status = "scheduled";
        campaign.scheduledAt = scheduledAt;
        campaign.updatedAt = ctx.now().toISOString();
        await db.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='campaigns' AND id=$2", [campaign, id]);
        await recordRuleEvent(db, { eventId: `campaign:${id}:scheduled:${campaign.scheduledAt}`, type: "campaign.scheduled", campaignId: id, campaignName: String(campaign.name), listIds: campaign.listIds });
        await audit(ctx, request, "campaign.schedule", "campaigns", id);
        response.json({ data: campaign });
    }));
    router.post("/campaigns/:campaignId/send", mutation, need("campaigns:send"), wrap(async (request, response) => {
        await validActivation(ctx);
        const id = String(request.params.campaignId), campaign = await getEntity(ctx, "campaigns", id);
        assertEntityAllowed(request, "campaigns", campaign);
        if (!["draft", "scheduled", "paused"].includes(String(campaign.status)))
            throw http(409, "Campaign cannot be queued");
        const audience = await resolveCampaignAudience(audienceRepository, await installationScope(db), {
            listIds: campaign.listIds,
            segmentIds: campaign.segmentIds,
            excludeListIds: campaign.excludeListIds,
            excludeSegmentIds: campaign.excludeSegmentIds,
        }, restrictedLists(request), ctx.now().toISOString());
        const template = await getEntity(ctx, "templates", String(campaign.templateId));
        for (const subscriber of audience.recipients) {
            const custom = subscriber.metadata && typeof subscriber.metadata === "object" && !Array.isArray(subscriber.metadata) ? subscriber.metadata : {};
            const variables = { ...custom, email: subscriber.email, firstName: subscriber.firstName ?? "", lastName: subscriber.lastName ?? "", name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" "), unsubscribe_url: "{{unsubscribe_url}}" };
            const missing = String(campaign.mergeMissingPolicy ?? "empty");
            const frozenCampaign = { ...campaign, subject: renderMergeVariables(String(campaign.subject), variables, { format: "text", missing }) };
            const frozenTemplate = {
                ...template,
                subject: renderMergeVariables(String(template.subject ?? ""), variables, { format: "text", missing }),
                html: renderMergeVariables(String(template.html ?? ""), variables, { format: "html", missing }),
                text: renderMergeVariables(String(template.text ?? ""), variables, { format: "text", missing }),
            };
            await db.query("INSERT INTO campaigns.jobs(id,campaign_id,recipient_id,kind,state,run_at,snapshot) VALUES($1,$2,$3,'campaign','queued',coalesce($4::timestamptz,now()),$5) ON CONFLICT(campaign_id,recipient_id,kind) DO NOTHING", [randomUUID(), id, subscriber.id, campaign.scheduledAt, { campaign: frozenCampaign, template: frozenTemplate, subscriber, audience: { scope: audience.scope, generatedAt: audience.generatedAt, source: audience.source } }]);
        }
        campaign.status = campaign.scheduledAt && new Date(String(campaign.scheduledAt)) > ctx.now() ? "scheduled" : "sending";
        campaign.statistics = { ...campaign.statistics, recipients: audience.recipients.length };
        campaign.updatedAt = ctx.now().toISOString();
        await db.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='campaigns' AND id=$2", [campaign, id]);
        await recordRuleEvent(db, { eventId: `campaign:${id}:sending`, type: "campaign.sending", campaignId: id, campaignName: String(campaign.name), listIds: campaign.listIds });
        await audit(ctx, request, "campaign.send", "campaigns", id, { recipients: audience.recipients.length, listIds: audience.source.listIds, segmentIds: audience.source.segmentIds, excludeListIds: audience.source.excludeListIds, excludeSegmentIds: audience.source.excludeSegmentIds });
        response.status(202).json({ data: campaign });
    }));
    router.post("/campaigns/:campaignId/pause", mutation, need("campaigns:send"), campaignAction("pause"));
    router.post("/campaigns/:campaignId/resume", mutation, need("campaigns:send"), campaignAction("resume"));
    router.post("/campaigns/:campaignId/cancel", mutation, need("campaigns:send"), campaignAction("cancel"));
    router.post("/campaigns/:campaignId/test", mutation, need("campaigns:send"), wrap(async (request, response) => {
        const body = json(request.body);
        // Validate the complete bounded recipient set before activation checks or any
        // database write, so malformed requests can never enqueue a partial send.
        const recipients = testRecipients(body);
        await validActivation(ctx);
        const id = String(request.params.campaignId), campaign = await getEntity(ctx, "campaigns", id), template = await getEntity(ctx, "templates", String(campaign.templateId));
        assertEntityAllowed(request, "campaigns", campaign);
        const provider = await db.query("SELECT body,secret FROM campaigns.entities WHERE kind='providers' AND id=$1 AND body->>'enabled'='true'", [campaign.providerId]);
        if (!provider.rows[0]?.secret)
            throw http(409, "Campaign provider is not enabled and configured");
        validateProvider(provider.rows[0].body, undefined, true);
        // Also parse/decrypt the immutable configuration now. A malformed stored
        // credential must reject the whole request rather than create dead jobs.
        const config = deliveryConfig(provider.rows[0].body, decrypted(ctx.key, provider.rows[0].secret));
        try {
            // Provider verification is a non-sending credential/configuration check.
            // It is local to the selected delivery provider and never calls a
            // SendRepute paid-analysis operation or central balance ledger.
            await ctx.verify(config);
        }
        catch {
            throw http(502, "Campaign provider verification failed");
        }
        const jobs = recipients.map(recipient => {
            const variables = {
                email: recipient,
                firstName: "Test",
                lastName: "Recipient",
                name: "Test Recipient",
            };
            const missing = String(campaign.mergeMissingPolicy ?? "empty");
            const frozenCampaign = {
                ...campaign,
                subject: renderMergeVariables(String(campaign.subject), variables, { format: "text", missing }),
            };
            const frozenTemplate = {
                ...template,
                subject: renderMergeVariables(String(template.subject ?? ""), variables, { format: "text", missing }),
                html: renderMergeVariables(String(template.html ?? ""), variables, { format: "html", missing }),
                text: renderMergeVariables(String(template.text ?? ""), variables, { format: "text", missing }),
            };
            return {
                id: randomUUID(),
                recipient,
                snapshot: {
                    campaign: frozenCampaign,
                    template: frozenTemplate,
                    subscriber: { email: recipient, firstName: "Test", lastName: "Recipient" },
                    test: { mergeContext: variables, requestedBy: request.user.id, requestedAt: ctx.now().toISOString() },
                },
            };
        });
        const queued = [];
        for (const job of jobs) {
            const inserted = await db.query(`INSERT INTO campaigns.jobs(id,campaign_id,kind,state,run_at,snapshot)
         VALUES($1,$2,'test','queued',now(),$3)
         ON CONFLICT DO NOTHING RETURNING id`, [job.id, id, job.snapshot]);
            if (inserted.rows[0])
                queued.push({ id: inserted.rows[0].id, recipient: job.recipient });
        }
        const active = await db.query(`SELECT DISTINCT ON (lower(snapshot->'subscriber'->>'email'))
          id,lower(snapshot->'subscriber'->>'email') recipient
       FROM campaigns.jobs
       WHERE campaign_id=$1 AND kind='test'
         AND lower(snapshot->'subscriber'->>'email')=ANY($2::text[])
       ORDER BY lower(snapshot->'subscriber'->>'email'),created_at DESC,id DESC`, [id, recipients]);
        await audit(ctx, request, "campaign.test", "campaigns", id, {
            recipients, queued: queued.length, alreadyActive: recipients.length - queued.length,
        });
        response.status(202).json({ data: {
                ok: true,
                id,
                queued: queued.length,
                recipients,
                jobIds: active.rows.map(job => job.id),
                message: `${recipients.length} test delivery request(s) are queued or already in progress. This confirms queue acceptance, not inbox delivery.`,
            } });
    }));
    router.get("/roles", need("users:manage"), wrap(async (request, response) => {
        const values = await listRows(ctx, "roles", request), p = page(request);
        response.json({ data: values.rows, meta: { page: p.page, pageSize: p.pageSize, total: values.total } });
    }));
    router.post("/roles", mutation, need("roles:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["name", "description", "permissions"], ["name", "permissions"]);
        const actor = request.user, requested = body.permissions;
        if (!actor.permissions.includes("*") && requested.some(p => !actor.permissions.includes(p)))
            throw http(403, "Cannot grant permissions you do not hold");
        const now = ctx.now().toISOString(), value = { id: randomUUID(), name: String(body.name), description: body.description ?? null, permissions: [...new Set(requested)], system: false, createdAt: now, updatedAt: now };
        await db.query("INSERT INTO campaigns.roles(id,body) VALUES($1,$2)", [value.id, value]);
        await audit(ctx, request, "role.create", "roles", value.id);
        response.status(201).json({ data: value });
    }));
    router.get("/roles/:roleId", need("users:manage"), wrap(async (request, response) => {
        const result = await db.query("SELECT body FROM campaigns.roles WHERE id=$1", [request.params.roleId]);
        if (!result.rows[0])
            throw http(404, "Not found");
        response.json({ data: result.rows[0].body });
    }));
    router.patch("/roles/:roleId", mutation, need("roles:manage"), wrap(async (request, response) => {
        const result = await db.query("SELECT body,system FROM campaigns.roles WHERE id=$1", [request.params.roleId]);
        if (!result.rows[0])
            throw http(404, "Not found");
        if (result.rows[0].system)
            throw http(409, "System roles are immutable");
        const body = json(request.body);
        fields(body, ["name", "description", "permissions"]);
        if (!Object.keys(body).length)
            throw http(400, "Patch must not be empty");
        const requested = (body.permissions ?? result.rows[0].body.permissions);
        if (!request.user.permissions.includes("*") && requested.some(p => !request.user.permissions.includes(p)))
            throw http(403, "Cannot grant permissions you do not hold");
        const value = { ...result.rows[0].body, ...body, permissions: [...new Set(requested)], updatedAt: ctx.now().toISOString() };
        await db.query("UPDATE campaigns.roles SET body=$2,updated_at=now() WHERE id=$1", [request.params.roleId, value]);
        await audit(ctx, request, "role.update", "roles", String(request.params.roleId));
        response.json({ data: value });
    }));
    router.delete("/roles/:roleId", mutation, need("roles:manage"), wrap(async (request, response) => {
        const role = await db.query("SELECT system FROM campaigns.roles WHERE id=$1", [request.params.roleId]);
        if (!role.rows[0])
            throw http(404, "Not found");
        if (role.rows[0].system)
            throw http(409, "System roles are immutable");
        if ((await db.query("SELECT 1 FROM campaigns.users WHERE body->'roleIds' ? $1 LIMIT 1", [request.params.roleId])).rowCount)
            throw http(409, "Role is assigned");
        await db.query("DELETE FROM campaigns.roles WHERE id=$1", [request.params.roleId]);
        await audit(ctx, request, "role.delete", "roles", String(request.params.roleId));
        response.status(204).end();
    }));
    async function assertUserRoles(request, roleIds, database = db) {
        const roles = await database.query("SELECT id,body FROM campaigns.roles WHERE id=ANY($1::uuid[])", [roleIds]);
        if (roles.rowCount !== roleIds.length)
            throw http(400, "Unknown role");
        if (!request.user.permissions.includes("*")) {
            const granted = new Set(request.user.permissions);
            for (const role of roles.rows)
                for (const item of role.body.permissions)
                    if (!granted.has(item))
                        throw http(403, "Cannot assign a role with permissions you do not hold");
        }
    }
    async function ownerRoleId(database = db) {
        const result = await database.query("SELECT id FROM campaigns.roles WHERE system AND lower(body->>'name')='owner' LIMIT 1");
        if (!result.rows[0])
            throw http(500, "Owner role is missing");
        return result.rows[0].id;
    }
    async function guardLastOwner(database, userId, nextActive, nextRoles, deleting = false) {
        const owner = await ownerRoleId(database);
        const current = await database.query("SELECT body FROM campaigns.users WHERE id=$1", [userId]);
        if (!current.rows[0])
            throw http(404, "Not found");
        const isOwner = current.rows[0].body.roleIds.includes(owner) && current.rows[0].body.active !== false;
        const remains = !deleting && nextActive && nextRoles.includes(owner);
        if (isOwner && !remains) {
            const others = await database.query("SELECT 1 FROM campaigns.users WHERE id<>$1 AND body->>'active'='true' AND body->'roleIds' ? $2 LIMIT 1", [userId, owner]);
            if (!others.rowCount)
                throw http(409, "Cannot remove the last active owner");
        }
    }
    router.get("/users", need("users:manage"), wrap(async (request, response) => {
        const values = await listRows(ctx, "users", request), p = page(request);
        response.json({ data: values.rows, meta: { page: p.page, pageSize: p.pageSize, total: values.total } });
    }));
    router.post("/users", mutation, need("users:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["name", "email", "password", "active", "roleIds", "listIds"], ["name", "email", "password", "roleIds"]);
        const password = validatePassword(body.password);
        const roleIds = body.roleIds;
        await assertUserRoles(request, roleIds);
        const actorLists = restrictedLists(request);
        const listIds = Array.isArray(body.listIds) ? [...new Set(body.listIds.map(String))] : actorLists ?? undefined;
        if (listIds) {
            assertListsAllowed(request, listIds);
            if ((await db.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [listIds])).rowCount !== listIds.length)
                throw http(400, "Unknown list");
        }
        const now = ctx.now().toISOString(), value = { id: randomUUID(), name: String(body.name), email: email(body.email), active: body.active !== false, roleIds, ...(listIds === undefined ? {} : { listIds }), lastLoginAt: null, createdAt: now, updatedAt: now };
        try {
            await db.query("INSERT INTO campaigns.users(id,email,password_hash,body) VALUES($1,$2,$3,$4)", [value.id, value.email, await passwordHash(password), value]);
        }
        catch (error) {
            if (error.code === "23505")
                throw http(409, "Email already exists");
            throw error;
        }
        await audit(ctx, request, "user.create", "users", value.id);
        response.status(201).json({ data: value });
    }));
    router.get("/users/:userId", need("users:manage"), wrap(async (request, response) => {
        const result = await db.query("SELECT body FROM campaigns.users WHERE id=$1", [request.params.userId]);
        if (!result.rows[0])
            throw http(404, "Not found");
        response.json({ data: result.rows[0].body });
    }));
    router.patch("/users/:userId", mutation, need("users:manage"), wrap(async (request, response) => {
        const client = await db.connect?.(), tx = client ?? db;
        let value;
        try {
            await tx.query("BEGIN");
            await tx.query("SELECT pg_advisory_xact_lock($1)", [LAST_OWNER_LOCK]);
            const result = await tx.query("SELECT body FROM campaigns.users WHERE id=$1", [request.params.userId]);
            if (!result.rows[0])
                throw http(404, "Not found");
            const body = json(request.body);
            fields(body, ["name", "email", "password", "active", "roleIds", "listIds"]);
            if (!Object.keys(body).length)
                throw http(400, "Patch must not be empty");
            const roles = (body.roleIds ?? result.rows[0].body.roleIds);
            await assertUserRoles(request, roles, tx);
            const active = body.active === undefined ? result.rows[0].body.active !== false : body.active === true;
            const listIds = body.listIds === undefined ? result.rows[0].body.listIds : Array.isArray(body.listIds) ? [...new Set(body.listIds.map(String))] : (() => { throw http(400, "listIds must be an array"); })();
            if (restrictedLists(request) && (!Array.isArray(listIds) || listIds.length === 0))
                throw http(403, "A restricted administrator cannot remove list restrictions");
            if (Array.isArray(listIds) && listIds.length) {
                assertListsAllowed(request, listIds);
                if ((await tx.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [listIds])).rowCount !== listIds.length)
                    throw http(400, "Unknown list");
            }
            await guardLastOwner(tx, String(request.params.userId), active, roles);
            const { password, ...safe } = body;
            const nextPassword = password === undefined ? undefined : validatePassword(password);
            value = { ...result.rows[0].body, ...safe, ...(safe.email ? { email: email(safe.email) } : {}), ...(listIds === undefined ? {} : { listIds }), roleIds: roles, active, updatedAt: ctx.now().toISOString() };
            await tx.query(nextPassword !== undefined ? "UPDATE campaigns.users SET email=$2,password_hash=$3,body=$4,updated_at=now() WHERE id=$1" : "UPDATE campaigns.users SET email=$2,body=$3,updated_at=now() WHERE id=$1", nextPassword !== undefined ? [request.params.userId, value.email, await passwordHash(nextPassword), value] : [request.params.userId, value.email, value]);
            if (!active || nextPassword !== undefined)
                await tx.query("DELETE FROM campaigns.sessions WHERE user_id=$1", [request.params.userId]);
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        await audit(ctx, request, "user.update", "users", String(request.params.userId));
        response.json({ data: value });
    }));
    router.delete("/users/:userId", mutation, need("users:manage"), wrap(async (request, response) => {
        const client = await db.connect?.(), tx = client ?? db;
        try {
            await tx.query("BEGIN");
            await tx.query("SELECT pg_advisory_xact_lock($1)", [LAST_OWNER_LOCK]);
            await guardLastOwner(tx, String(request.params.userId), false, [], true);
            await tx.query("DELETE FROM campaigns.users WHERE id=$1", [request.params.userId]);
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        await audit(ctx, request, "user.delete", "users", String(request.params.userId));
        response.status(204).end();
    }));
    router.get("/audit", need("users:manage"), wrap(async (request, response) => {
        const values = await listRows(ctx, "audit", request), p = page(request);
        response.json({ data: values.rows, meta: { page: p.page, pageSize: p.pageSize, total: values.total } });
    }));
    router.get("/settings", need(), wrap(async (_request, response) => {
        const result = await db.query("SELECT settings FROM campaigns.installation");
        if (!result.rows[0])
            throw http(503, "Not installed");
        response.json({ data: result.rows[0].settings });
    }));
    router.patch("/settings", mutation, need("settings:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["instanceName", "publicUrl", "defaultFromName", "defaultFromEmail", "doubleOptIn", "trackingEnabled", "timezone", "metadata"]);
        if (!Object.keys(body).length)
            throw http(400, "Patch must not be empty");
        if (body.publicUrl !== undefined)
            body.publicUrl = publicUrl(body.publicUrl).toString();
        if (body.defaultFromEmail)
            body.defaultFromEmail = email(body.defaultFromEmail);
        const result = await db.query("UPDATE campaigns.installation SET settings=settings||$1::jsonb RETURNING settings", [body]);
        await audit(ctx, request, "settings.update", "settings", null);
        response.json({ data: result.rows[0].settings });
    }));
    router.get("/connection", need(), wrap(async (_request, response) => {
        const value = await validActivation(ctx, true);
        response.json({ data: safeConnection(value) });
    }));
    router.put("/connection", mutation, need("connection:manage"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["apiBaseUrl", "apiKey"], ["apiBaseUrl", "apiKey"]);
        if (String(body.apiBaseUrl) !== PRODUCTION_API_BASE_URL)
            throw http(400, "Only the published SendRepute API URL is accepted");
        let snapshot;
        try {
            snapshot = await ctx.bridgeFactory(String(body.apiKey)).getConnectionSnapshot();
        }
        catch (error) {
            throw activationError(error);
        }
        const balance = snapshot.balance;
        const value = { configured: true, connected: true, apiBaseUrl: body.apiBaseUrl, accountEmail: null, accountId: null, plan: null, balanceMillicents: Number(balance?.availableMillicents ?? 0), lastCheckedAt: ctx.now().toISOString(), error: null, snapshot };
        await db.query("UPDATE campaigns.installation SET connection_secret=$1,connection=$2", [encrypted(ctx.key, String(body.apiKey)), value]);
        await audit(ctx, request, "connection.update", "connection", null);
        response.json({ data: safeConnection(value) });
    }));
    router.post("/connection/refresh", mutation, need("connection:manage"), wrap(async (_request, response) => {
        const value = await validActivation(ctx, true);
        response.json({ data: safeConnection(value) });
    }));
    router.post("/sendrepute", mutation, need("api:use"), wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["operation", "input", "paidConsent"], ["operation", "input", "paidConsent"]);
        const operation = String(body.operation);
        const capability = operationCapabilities[operation];
        if (!capability)
            throw http(400, "Unsupported SendRepute operation");
        if (capability.billable && body.paidConsent !== true)
            throw http(402, "Explicit paid consent is required");
        if (capability.billable && !permitted(request, "api:spend"))
            throw http(403, "API spend permission is required");
        const startedAt = Date.now();
        try {
            await validActivation(ctx);
            const item = await connection(ctx);
            if (!item)
                throw http(503, "Not installed");
            const result = await ctx.bridgeFactory(item.secret).execute(operation, body.input);
            await audit(ctx, request, "sendrepute.execute", "connection", null, { operation, outcome: "success", durationMs: Date.now() - startedAt });
            response.json({ data: { operation, result, charged: capability.billable } });
        }
        catch (error) {
            const code = error.code;
            await audit(ctx, request, "sendrepute.execute", "connection", null, {
                operation, outcome: "failed", errorCode: typeof code === "string" ? code : "EXECUTION_FAILED", durationMs: Date.now() - startedAt,
            });
            throw error;
        }
    }));
    router.post("/backup/export", mutation, need("*"), wrap(async (request, response) => {
        if ((await db.query("SELECT 1 FROM campaigns.subscriber_reconciliations LIMIT 1")).rowCount)
            throw http(409, "Application backup export blocked: reconciled identities require a full PostgreSQL backup including immutable evidence and historical references");
        const body = json(request.body);
        fields(body, ["confirmation"], ["confirmation"]);
        if (body.confirmation !== "EXPORT_BACKUP")
            throw http(400, "Invalid confirmation");
        const settings = await db.query("SELECT settings FROM campaigns.installation");
        const entities = await db.query("SELECT kind,body FROM campaigns.entities ORDER BY kind,created_at");
        const roles = await db.query("SELECT body FROM campaigns.roles WHERE NOT system ORDER BY created_at");
        const scope = await installationScope(db);
        const segments = await audienceRepository.listSegments(scope);
        const brands = await db.query(`SELECT id,name,logo_url "logoUrl",color,default_from_name "defaultFromName",
      default_from_email "defaultFromEmail",default_reply_to "defaultReplyTo",created_at "createdAt",updated_at "updatedAt"
      FROM campaigns.brands WHERE scope=$1 ORDER BY created_at,id`, [scope]);
        const [rules, subscriptionCustomizations, domains, automations, providerAnalytics] = await Promise.all([
            db.query(`SELECT id,name,enabled,trigger_type "triggerType",trigger_list_id "triggerListId",
        action_type "actionType",action_config "actionConfig" FROM campaigns.event_rules ORDER BY created_at,id`),
            db.query(`SELECT list_id "listId",page_content "pageContent",form_config form,opt_in_mode "optInMode",
        welcome_enabled "welcomeEnabled",welcome_template_id "welcomeTemplateId",welcome_provider_id "welcomeProviderId",
        goodbye_enabled "goodbyeEnabled",goodbye_template_id "goodbyeTemplateId",goodbye_provider_id "goodbyeProviderId"
        FROM campaigns.subscription_customizations ORDER BY list_id`),
            db.query(`SELECT id,hostname,base_path "basePath" FROM campaigns.custom_domains ORDER BY created_at,id`),
            db.query(`SELECT id,body,status FROM campaigns.automations ORDER BY created_at,id`),
            db.query(`SELECT provider_id "providerId",enabled,track_opens "trackOpens",track_clicks "trackClicks",
        webhook_configured "webhookConfigured" FROM campaigns.provider_analytics_state ORDER BY provider_id`),
        ]);
        const currentSettings = settings.rows[0]?.settings ?? {};
        // Deliberate backup allowlist: insight snapshots/results and replay IDs are
        // short-lived operational data, never exportable/restorable payloads.
        const data = {
            settings: currentSettings, housekeepingSettings: currentSettings.housekeeping ?? {}, brands: brands.rows,
            rules: rules.rows.map(row => ({ ...row, ...(row.actionType === "webhook" ? { requiresSecretReentry: true } : {}) })),
            subscriptionCustomizations: subscriptionCustomizations.rows, domains: domains.rows,
            automations: automations.rows, providerAnalytics: providerAnalytics.rows,
            roles: roles.rows.map(r => r.body), audience: { customFields: await customFieldDefinitions(db, scope), segments },
        };
        for (const kind of KINDS)
            data[kind] = entities.rows.filter(r => r.kind === kind).map(r => publicEntity(kind, r.body));
        await audit(ctx, request, "backup.export", "backup", null);
        response.json({ format: "sendrepute-campaigns-backup", version: 3, exportedAt: ctx.now().toISOString(), data });
    }));
    router.post("/backup/import", mutation, need("*"), wrap(async (request, response) => {
        if (request.query.confirmation !== "IMPORT_BACKUP")
            throw http(400, "Invalid confirmation");
        const backup = json(request.body);
        fields(backup, ["format", "version", "exportedAt", "data"], ["format", "version", "exportedAt", "data"]);
        if (backup.format !== "sendrepute-campaigns-backup" || (backup.version !== 2 && backup.version !== 3))
            throw http(400, "Unsupported backup format; supported versions are 2 and 3");
        const data = json(backup.data);
        fields(data, [...KINDS, "settings", "housekeepingSettings", "brands", "rules", "subscriptionCustomizations", "domains", "automations", "providerAnalytics", "roles", "audience"]);
        const all = KINDS.flatMap(kind => {
            const values = data[kind];
            if (!Array.isArray(values) || values.length > 100_000)
                throw http(400, `Invalid ${kind} collection`);
            return values.map(value => ({ kind, value: json(value) }));
        });
        if (Buffer.byteLength(JSON.stringify(backup)) > 32 * 1024 * 1024)
            throw http(413, "Backup too large");
        const audience = json(data.audience);
        fields(audience, ["customFields", "segments"], ["customFields", "segments"]);
        const definitions = validateCustomFieldDefinitions(audience.customFields);
        if (!Array.isArray(audience.segments) || audience.segments.length > 10_000)
            throw http(400, "Invalid audience segments");
        const segments = audience.segments.map(item => {
            const segment = json(item);
            fields(segment, ["id", "scope", "name", "description", "predicate", "createdAt", "updatedAt"], ["id", "name", "predicate"]);
            compileAudiencePredicate(segment.predicate, definitions);
            return segment;
        });
        const importedSettings = json(data.settings ?? {});
        if (backup.version === 3) {
            const housekeepingSettings = json(data.housekeepingSettings ?? {});
            importedSettings.housekeeping = housekeepingSettings;
        }
        const rawBrands = backup.version === 3 ? data.brands : [];
        if (!Array.isArray(rawBrands) || rawBrands.length > 10_000)
            throw http(400, "Invalid brands collection");
        const brands = rawBrands.map(item => {
            const brand = json(item);
            fields(brand, ["id", "name", "logoUrl", "color", "defaultFromName", "defaultFromEmail", "defaultReplyTo", "createdAt", "updatedAt"], ["id", "name"]);
            if (!ENTITY_UUID.test(String(brand.id)) || typeof brand.name !== "string" || !brand.name.trim() || brand.name.length > 120)
                throw http(400, "Invalid backup brand");
            if (brand.color != null && !/^#[0-9a-f]{6}$/i.test(String(brand.color)))
                throw http(400, "Invalid backup brand color");
            for (const key of ["defaultFromEmail", "defaultReplyTo"])
                if (brand[key] != null)
                    email(brand[key]);
            if (brand.logoUrl != null) {
                const logo = new URL(String(brand.logoUrl));
                if (logo.protocol !== "https:" || logo.username || logo.password)
                    throw http(400, "Invalid backup brand logoUrl");
            }
            return brand;
        });
        if (new Set(brands.map(brand => String(brand.id))).size !== brands.length)
            throw http(400, "Duplicate backup brand");
        const brandIds = new Set(brands.map(brand => String(brand.id)));
        const backupCollection = (key, limit = 10_000) => {
            const value = backup.version === 3 ? data[key] ?? [] : [];
            if (!Array.isArray(value) || value.length > limit)
                throw http(400, `Invalid ${key} collection`);
            return value.map(item => json(item));
        };
        const rules = backupCollection("rules");
        const subscriptionCustomizations = backupCollection("subscriptionCustomizations");
        const domains = backupCollection("domains");
        const automations = backupCollection("automations");
        const providerAnalytics = backupCollection("providerAnalytics");
        for (const item of [...rules, ...domains, ...automations])
            if (!ENTITY_UUID.test(String(item.id)))
                throw http(400, "Backup configuration has an invalid ID");
        const scope = await installationScope(db);
        const importedByKind = new Map(KINDS.map(kind => [kind, new Set(all.filter(row => row.kind === kind).map(row => String(row.value.id)))]));
        const subscriberEmails = new Set();
        for (const row of all) {
            if (row.kind === "subscribers") {
                const address = email(row.value.email);
                if (subscriberEmails.has(address))
                    throw http(409, "Backup contains duplicate subscriber emails");
                subscriberEmails.add(address);
                row.value.email = address;
                row.value.tags = subscriberTags(row.value.tags);
                if (!Array.isArray(row.value.listIds) || row.value.listIds.length === 0 ||
                    row.value.listIds.some(id => !importedByKind.get("lists").has(String(id))))
                    throw http(400, "Backup subscriber references an unknown list");
            }
            if (row.kind === "campaigns") {
                if (!Array.isArray(row.value.listIds) || row.value.listIds.some(id => !importedByKind.get("lists").has(String(id))))
                    throw http(400, "Backup campaign references an unknown list");
                if (!importedByKind.get("templates").has(String(row.value.templateId)))
                    throw http(400, "Backup campaign references an unknown template");
                if (!importedByKind.get("providers").has(String(row.value.providerId)))
                    throw http(400, "Backup campaign references an unknown provider");
            }
            if (["lists", "templates", "campaigns"].includes(row.kind) && row.value.brandId != null && !brandIds.has(String(row.value.brandId)))
                throw http(400, `Backup ${row.kind} references an unknown brand`);
            if (row.kind === "providers") {
                // Backups intentionally never contain encrypted credentials. Keep the
                // public routing metadata, validate it, and require credential
                // re-entry before this provider can be used.
                row.value.enabled = false;
                row.value.configured = false;
                validateProvider(row.value, undefined, false);
            }
        }
        const client = await db.connect?.(), tx = client ?? db;
        try {
            await tx.query("BEGIN");
            await tx.query("SELECT pg_advisory_xact_lock($1)", [DELIVERY_RESTORE_LOCK]);
            await lockSubscribers(tx);
            if ((await tx.query("SELECT 1 FROM campaigns.subscriber_reconciliations LIMIT 1")).rowCount)
                throw http(409, "Backup restore blocked: reconciled subscriber identities require full PostgreSQL backup recovery; application backups omit immutable identity evidence");
            if ((await tx.query("SELECT 1 FROM campaigns.experiments LIMIT 1")).rowCount)
                throw http(409, "Backup restore blocked: immutable experiments exist; restore into a fresh installation");
            if ((await tx.query("SELECT 1 FROM campaigns.automation_runs WHERE state IN ('running','unknown') LIMIT 1")).rowCount)
                throw http(409, "Backup restore blocked by unresolved automation runs");
            const outstanding = await tx.query("SELECT state,count(*)::text count FROM campaigns.jobs WHERE state IN ('queued','sending','unknown') GROUP BY state ORDER BY state");
            if (outstanding.rowCount) {
                const summary = outstanding.rows.map(row => `${row.state}:${row.count}`).join(", ");
                throw http(409, `Backup restore blocked by unresolved delivery jobs (${summary})`);
            }
            await tx.query("SELECT set_config('campaigns.restoring','true',true)");
            await tx.query("UPDATE campaigns.automations SET status='paused',updated_at=now() WHERE status='active'");
            // A restored campaign must not inherit pre-restore quotes, aggregates or
            // results. Backups cannot resurrect these retention-limited records.
            await tx.query("DELETE FROM campaigns.insight_requests");
            await tx.query("DELETE FROM campaigns.entities");
            await tx.query("DELETE FROM campaigns.brands WHERE scope=$1", [scope]);
            for (const brand of brands)
                await tx.query(`INSERT INTO campaigns.brands
        (id,scope,name,logo_url,color,default_from_name,default_from_email,default_reply_to)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [brand.id, scope, brand.name, brand.logoUrl ?? null, brand.color ?? null, brand.defaultFromName ?? null, brand.defaultFromEmail ?? null, brand.defaultReplyTo ?? null]);
            for (const row of all) {
                const value = row.kind === "subscribers" ? { ...row.value, scope } : row.value;
                if (row.kind === "subscribers")
                    value.metadata = validateCustomValues(value.metadata ?? {}, definitions);
                await tx.query("INSERT INTO campaigns.entities(kind,id,body) VALUES($1,$2,$3)", [row.kind, value.id, value]);
            }
            await tx.query("DELETE FROM campaigns.audience_segments WHERE scope=$1", [scope]);
            await tx.query("DELETE FROM campaigns.audience_custom_fields WHERE scope=$1", [scope]);
            await tx.query("DELETE FROM campaigns.tokens");
            await tx.query("DELETE FROM campaigns.rate_limits");
            for (const definition of definitions)
                await tx.query("INSERT INTO campaigns.audience_custom_fields(scope,key,definition) VALUES($1,$2,$3)", [scope, definition.key, definition]);
            for (const segment of segments)
                await tx.query("INSERT INTO campaigns.audience_segments(scope,id,name,description,predicate) VALUES($1,$2,$3,$4,$5)", [scope, segment.id, segment.name, segment.description ?? null, segment.predicate]);
            await tx.query("DELETE FROM campaigns.event_rules");
            for (const rule of rules) {
                if (!["campaign.scheduled", "campaign.sending", "campaign.sent", "automation.sent", "list.joined"].includes(String(rule.triggerType)) ||
                    !["webhook", "unsubscribe", "email_notification"].includes(String(rule.actionType)))
                    throw http(400, "Invalid backup rule");
                const webhook = rule.actionType === "webhook";
                await tx.query(`INSERT INTO campaigns.event_rules
          (id,name,enabled,trigger_type,trigger_list_id,action_type,action_config,encrypted_secret)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [rule.id, String(rule.name), webhook ? false : rule.enabled === true, rule.triggerType, rule.triggerListId ?? null,
                    rule.actionType, webhook ? { ...json(rule.actionConfig), restoreRequiresSecret: true } : json(rule.actionConfig),
                    webhook ? encrypted(ctx.key, randomBytes(32).toString("base64url")) : null]);
            }
            await tx.query("DELETE FROM campaigns.subscription_customizations");
            for (const config of subscriptionCustomizations)
                await tx.query(`INSERT INTO campaigns.subscription_customizations
        (list_id,brand_scope,page_content,form_config,opt_in_mode,welcome_enabled,welcome_template_id,welcome_provider_id,
         goodbye_enabled,goodbye_template_id,goodbye_provider_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [config.listId, scope, config.pageContent ?? {}, config.form ?? {}, config.optInMode ?? null,
                    config.welcomeEnabled === true, config.welcomeTemplateId ?? null, config.welcomeProviderId ?? null,
                    config.goodbyeEnabled === true, config.goodbyeTemplateId ?? null, config.goodbyeProviderId ?? null]);
            await tx.query("DELETE FROM campaigns.custom_domains");
            for (const domain of domains)
                await tx.query("INSERT INTO campaigns.custom_domains(id,hostname,base_path,challenge,verified_at,last_checked_at,last_error) VALUES($1,$2,$3,$4,NULL,NULL,'Reverification required after restore')", [domain.id, String(domain.hostname), String(domain.basePath ?? "/"), randomBytes(24).toString("base64url")]);
            for (const automation of automations)
                await tx.query(`INSERT INTO campaigns.automations(id,body,status) VALUES($1,$2,'paused')
         ON CONFLICT(id) DO UPDATE SET body=excluded.body,status='paused',updated_at=now()`, [automation.id, json(automation.body)]);
            await tx.query("DELETE FROM campaigns.provider_analytics_state");
            for (const state of providerAnalytics)
                await tx.query(`INSERT INTO campaigns.provider_analytics_state
        (provider_id,enabled,track_opens,track_clicks,webhook_configured)
        VALUES($1,$2,$3,$4,$5)`, [state.providerId, state.enabled === true, state.trackOpens === true, state.trackClicks === true, state.webhookConfigured === true]);
            await tx.query("UPDATE campaigns.installation SET settings=$1 WHERE singleton=true", [importedSettings]);
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        await audit(ctx, request, "backup.import", "backup", null, { records: all.length });
        response.json({ data: { ok: true, message: "Backup restored; provider and SendRepute credentials were intentionally not imported" } });
    }));
    router.get("/lists/:listId/subscription-link", need("read"), wrap(async (request, response) => {
        const listId = String(request.params.listId);
        const list = await getEntity(ctx, "lists", listId);
        assertEntityAllowed(request, "lists", list);
        const installation = await db.query("SELECT settings FROM campaigns.installation");
        if (!installation.rows[0])
            throw http(503, "Not installed");
        const signupUrl = publicSubscriptionUrl(String(installation.rows[0].settings.publicUrl), listId, subscriptionListToken(ctx.key, listId));
        response.json({ data: { signupUrl } });
    }));
    router.use(["/public/unsubscribe", "/public/subscription-status"], (_request, response, next) => {
        response.set("Cache-Control", "no-store");
        response.set("Referrer-Policy", "no-referrer");
        next();
    });
    router.get("/public/subscription-status", wrap(async (request, response) => {
        const token = String(request.query.token ?? "");
        const purpose = String(request.query.purpose ?? "");
        if (token.length < 16 || token.length > 512 || !["subscribe", "unsubscribe"].includes(purpose))
            throw http(400, "Invalid subscription status link");
        await consumePublicBudget(db, `subscription-status:${hash(`${request.ip ?? ""}:${token}`)}`, 30, "15 minutes");
        const result = await db.query("SELECT list_id,consumed_at,expires_at FROM campaigns.tokens WHERE token_hash=$1 AND purpose=$2", [hash(token), purpose]);
        const row = result.rows[0];
        if (!row)
            return void response.json({ data: { valid: false, purpose, state: "invalid", list: null, presentation: null } });
        const [list, customization] = await Promise.all([
            db.query("SELECT body FROM campaigns.entities WHERE kind='lists' AND id=$1", [row.list_id]),
            getSubscriptionCustomization(db, row.list_id),
        ]);
        const state = row.consumed_at ? "used" : row.expires_at.getTime() <= ctx.now().getTime() ? "expired" : "active";
        const page = customization.pageContent;
        const presentation = purpose === "subscribe"
            ? state === "used"
                ? { title: page.confirmedTitle, message: page.confirmedMessage }
                : { title: page.pendingTitle, message: page.pendingMessage }
            : state === "used"
                ? { title: page.goodbyeTitle, message: page.goodbyeMessage }
                : { title: page.unsubscribeTitle, message: page.unsubscribeMessage };
        response.json({ data: {
                valid: true, purpose, state,
                list: { id: row.list_id, name: String(list.rows[0]?.body.name ?? "") },
                presentation,
            } });
    }));
    router.get("/public/unsubscribe", wrap(async (request, response) => {
        const token = String(request.query.token ?? "");
        if (token.length < 16)
            throw http(400, "Invalid token");
        const result = await db.query("SELECT email,list_id,consumed_at FROM campaigns.tokens WHERE token_hash=$1 AND purpose='unsubscribe' AND expires_at>now()", [hash(token)]);
        const row = result.rows[0];
        if (!row)
            return void response.json({ data: { valid: false, maskedEmail: null, listName: null } });
        const list = await db.query("SELECT body FROM campaigns.entities WHERE kind='lists' AND id=$1", [row.list_id]);
        const [local, domain] = row.email.split("@");
        const masked = `${local?.[0] ?? "*"}***@${domain ?? ""}`;
        response.json({ data: { valid: true, maskedEmail: masked, listName: list.rows[0]?.body.name ?? null } });
    }));
    router.post("/public/unsubscribe", express.urlencoded({ extended: false, limit: "1kb", type: "application/x-www-form-urlencoded" }), wrap(async (request, response) => {
        const oneClick = request.query.oneClick === "1";
        if (oneClick && (request.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded"
            || !request.body
            || typeof request.body !== "object"
            || Array.isArray(request.body)
            || Object.keys(request.body).length !== 1
            || request.body["List-Unsubscribe"] !== "One-Click"))
            throw http(400, "Invalid RFC 8058 one-click request");
        const token = oneClick
            ? String(request.query.token ?? "")
            : (() => { const body = json(request.body); fields(body, ["token"], ["token"]); return String(body.token); })();
        if (token.length < 16)
            throw http(400, "Invalid token");
        const { subscriberId, previous } = await subscriberTransaction(db, async (tx) => {
            const result = await tx.query("SELECT subscriber_id FROM campaigns.tokens WHERE token_hash=$1 AND purpose='unsubscribe' AND expires_at>now() FOR UPDATE", [hash(token)]);
            if (!result.rows[0])
                throw http(400, "Invalid or expired token");
            const resolved = await tx.query("SELECT campaigns.reconciled_subscriber_id($1::uuid) AS id", [result.rows[0].subscriber_id]);
            const subscriberId = resolved.rows[0].id;
            // The signed token targets an ID, not the current installation scope.
            const before = await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1 FOR UPDATE", [subscriberId]);
            if (!before.rows[0])
                throw http(400, "Invalid or expired token");
            if (before.rows[0].body.status !== "unsubscribed") {
                await tx.query("UPDATE campaigns.entities SET body=body||jsonb_build_object('status','unsubscribed','unsubscribedAt',now(),'updatedAt',now()),updated_at=now() WHERE kind='subscribers' AND id=$1", [subscriberId]);
            }
            await tx.query("UPDATE campaigns.tokens SET consumed_at=coalesce(consumed_at,now()) WHERE token_hash=$1", [hash(token)]);
            return { subscriberId, previous: before.rows[0].body };
        });
        if (previous)
            for (const listId of previous.listIds ?? []) {
                await onUnsubscribe({ db, enqueue: enqueueSubscriptionMail }, {
                    listId, subscriberId, consentEpoch: ctx.now().toISOString(),
                    reason: "user", previousStatus: String(previous.status),
                });
            }
        await refreshListCounts(db);
        response.json({ data: { ok: true, message: "Unsubscribed" } });
    }));
    router.post("/public/subscribe", wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["listId", "listToken", "email", "firstName", "lastName", "metadata"], ["listId", "listToken", "email"]);
        const listId = String(body.listId);
        const expectedListToken = subscriptionListToken(ctx.key, listId);
        const suppliedListToken = String(body.listToken);
        if (suppliedListToken.length !== expectedListToken.length || !equalText(suppliedListToken, expectedListToken))
            throw http(400, "Invalid subscription link");
        if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='lists' AND id=$1", [listId])).rowCount)
            throw http(404, "List not found");
        const settings = await db.query("SELECT settings FROM campaigns.installation");
        if (!settings.rows[0])
            throw http(503, "Not installed");
        const scope = await installationScope(db);
        const customMetadata = validateCustomValues(body.metadata ?? {}, await customFieldDefinitions(db, scope));
        const address = email(body.email), token = randomBytes(32).toString("base64url"), id = randomUUID();
        await consumePublicBudget(db, hash(`subscribe-ip:${request.ip ?? "unknown"}:${listId}`), 20, "1 hour");
        await consumePublicBudget(db, hash(`subscribe-email:${address}:${listId}`), PUBLIC_SIGNUP_EMAIL_DAILY_LIMIT, "24 hours");
        const doubleOptIn = await resolveListDoubleOptIn(db, listId, settings.rows[0].settings.doubleOptIn !== false);
        let confirmed = null;
        const client = await db.connect?.(), tx = client ?? db;
        try {
            await tx.query("BEGIN");
            await lockSubscribers(tx);
            let providerId = null;
            if (doubleOptIn) {
                const provider = await tx.query("SELECT id FROM campaigns.entities WHERE kind='providers' AND body->>'enabled'='true' AND secret IS NOT NULL LIMIT 1");
                if (!provider.rows[0])
                    throw http(503, "No delivery provider is configured for double opt-in");
                providerId = provider.rows[0].id;
                const pending = await tx.query("SELECT 1 FROM campaigns.jobs WHERE kind='optin' AND state IN ('queued','sending') LIMIT $1", [MAX_PENDING_OPTIN_JOBS]);
                if ((pending.rowCount ?? 0) >= MAX_PENDING_OPTIN_JOBS)
                    throw http(503, "Confirmation queue is at capacity");
            }
            const old = await scopedSubscriber(tx, scope, address);
            const alreadyJoined = old?.status === "subscribed" && Array.isArray(old.listIds) && old.listIds.includes(listId);
            let suppressed = old?.status === "bounced" || old?.status === "complained" ||
                old?.hardBounced === true || old?.complained === true;
            if (old && (await tx.query("SELECT 1 FROM campaigns.subscriber_reconciliations WHERE subscriber_id=$1", [old.id])).rowCount)
                suppressed = true;
            if (old && !suppressed) {
                const events = await tx.query("SELECT 1 FROM campaigns.delivery_events WHERE recipient_id=$1 AND event_type IN ('provider_bounced','provider_complained') LIMIT 1", [old.id]);
                suppressed = Boolean(events.rowCount);
            }
            if (!alreadyJoined && !suppressed && !doubleOptIn) {
                let subscriberId;
                if (old) {
                    const value = normalize("subscribers", { status: "subscribed", listIds: [...new Set([...(old.listIds ?? []), listId])] }, old);
                    subscriberId = String(value.id);
                    await tx.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='subscribers' AND id=$2", [value, subscriberId]);
                }
                else {
                    const value = normalize("subscribers", { email: address, firstName: body.firstName ?? null, lastName: body.lastName ?? null, status: "subscribed", listIds: [listId], metadata: customMetadata, scope });
                    subscriberId = String(value.id);
                    await tx.query("INSERT INTO campaigns.entities(kind,id,body) VALUES('subscribers',$1,$2)", [value.id, value]);
                }
                const consentEpoch = ctx.now().toISOString();
                confirmed = { listId, subscriberId, consentEpoch };
                await recordRuleEvent(tx, { eventId: `subscribe:${subscriberId}:${listId}:${consentEpoch}`, type: "list.joined", subscriberId, listId });
                await refreshListCounts(tx);
            }
            else if (!alreadyJoined && !suppressed) {
                const url = publicCampaignsPageUrl(String(settings.rows[0].settings.publicUrl), "subscribe");
                url.searchParams.set("token", token);
                await tx.query("UPDATE campaigns.tokens SET consumed_at=now() WHERE purpose='subscribe' AND list_id=$1 AND lower(email)=$2 AND consumed_at IS NULL AND expires_at<=now()", [listId, address]);
                const inserted = await tx.query("INSERT INTO campaigns.tokens(token_hash,purpose,list_id,email,payload,expires_at) VALUES($1,'subscribe',$2,$3,$4,now()+interval '48 hours') ON CONFLICT DO NOTHING RETURNING token_hash", [hash(token), listId, address, { firstName: body.firstName ?? null, lastName: body.lastName ?? null, metadata: customMetadata, scope }]);
                if (inserted.rowCount) {
                    await tx.query("INSERT INTO campaigns.jobs(id,kind,state,run_at,snapshot) VALUES($1,'optin','queued',now(),$2)", [id, { providerId, subscriber: { email: address, scope }, campaign: { fromEmail: settings.rows[0].settings.defaultFromEmail, fromName: settings.rows[0].settings.defaultFromName, subject: "Confirm your subscription" }, template: { html: `<p>Confirm your subscription: <a href="${url.toString()}">Confirm</a></p>`, text: `Confirm your subscription: ${url.toString()}` } }]);
                }
            }
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        if (confirmed) {
            try {
                await onSubscribeConfirmed({ db, enqueue: enqueueSubscriptionMail }, confirmed);
            }
            catch {
                // Consent committed already. Mail handoff failures are reported to
                // operators, not to a public caller who could enumerate new addresses.
                console.error("Public subscription welcome handoff failed", { route: "/public/subscribe" });
            }
        }
        response.status(202).json({ data: { ok: true, message: "Subscription request accepted" } });
    }));
    router.post("/public/subscribe/confirm", wrap(async (request, response) => {
        const body = json(request.body);
        fields(body, ["token"], ["token"]);
        await consumePublicBudget(db, hash(`confirm-ip:${request.ip ?? "unknown"}`), 60, "1 hour");
        const scope = await installationScope(db);
        const client = await db.connect?.(), tx = client ?? db;
        let confirmed = null;
        try {
            await tx.query("BEGIN");
            await lockSubscribers(tx);
            const result = await tx.query("SELECT list_id,email,payload,consumed_at FROM campaigns.tokens WHERE token_hash=$1 AND purpose='subscribe' AND expires_at>now() FOR UPDATE", [hash(String(body.token))]);
            const row = result.rows[0];
            if (!row)
                throw http(400, "Invalid or expired token");
            if (!row.consumed_at) {
                const current = await scopedSubscriber(tx, scope, row.email);
                let suppressed = current?.status === "bounced" || current?.status === "complained" ||
                    current?.hardBounced === true || current?.complained === true;
                if (current && (await tx.query("SELECT 1 FROM campaigns.subscriber_reconciliations WHERE subscriber_id=$1", [current.id])).rowCount)
                    suppressed = true;
                if (current && !suppressed) {
                    const events = await tx.query("SELECT 1 FROM campaigns.delivery_events WHERE recipient_id=$1 AND event_type IN ('provider_bounced','provider_complained') LIMIT 1", [current.id]);
                    suppressed = Boolean(events.rowCount);
                }
                if (suppressed ||
                    (current?.status === "subscribed" && current.listIds?.includes(row.list_id))) {
                    // Consume stale confirmations without changing suppression or replaying joins.
                }
                else if (current) {
                    const value = normalize("subscribers", { status: "subscribed", listIds: [...new Set([...(current.listIds ?? []), row.list_id])] }, current);
                    await tx.query("UPDATE campaigns.entities SET body=$1,updated_at=now() WHERE kind='subscribers' AND id=$2", [value, value.id]);
                    confirmed = { listId: row.list_id, subscriberId: String(value.id), consentEpoch: ctx.now().toISOString() };
                }
                else {
                    const value = normalize("subscribers", { ...row.payload, email: row.email, scope, status: "subscribed", listIds: [row.list_id] });
                    await tx.query("INSERT INTO campaigns.entities(kind,id,body) VALUES('subscribers',$1,$2)", [value.id, value]);
                    confirmed = { listId: row.list_id, subscriberId: String(value.id), consentEpoch: ctx.now().toISOString() };
                }
                await tx.query("UPDATE campaigns.tokens SET consumed_at=now() WHERE token_hash=$1", [hash(String(body.token))]);
                if (confirmed) {
                    await recordRuleEvent(tx, { eventId: `confirm:${hash(String(body.token))}`, type: "list.joined", subscriberId: confirmed.subscriberId, listId: row.list_id });
                    await refreshListCounts(tx);
                }
            }
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        if (confirmed)
            await onSubscribeConfirmed({ db, enqueue: enqueueSubscriptionMail }, confirmed);
        response.json({ data: { ok: true, message: "Subscription confirmed" } });
    }));
    router.use(createAutomationsRouter({ db, mutation, need, wrap, assertListsAllowed, restrictedLists }));
    router.use(createExperimentsRouter({
        db, mutation, need, wrap, http, now: ctx.now,
        scope: installationScope, lists: restrictedLists,
        allowed: (request, campaign) => assertEntityAllowed(request, "campaigns", campaign),
        activation: () => validActivation(ctx),
        resolveAudience: (database, scope, campaign, allowed, generatedAt) => resolveCampaignAudience(createPostgresAudienceRepository(database), scope, {
            listIds: campaign.listIds, segmentIds: (campaign.segmentIds ?? []),
            excludeListIds: (campaign.excludeListIds ?? []), excludeSegmentIds: (campaign.excludeSegmentIds ?? []),
        }, allowed, generatedAt),
    }));
    router.use(createDeliveryReliabilityRouter({
        db,
        mutation,
        need,
        wrap,
        json,
        fields,
        page,
        http,
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
        assertCampaignAllowed: async (request, campaignId) => {
            const campaign = await getEntity(ctx, "campaigns", campaignId);
            assertEntityAllowed(request, "campaigns", campaign);
        },
    }));
    router.use(createTelegramNotificationsRouter({
        db,
        key: ctx.key,
        encrypt: encrypted,
        decrypt: decrypted,
        sender: ctx.telegramSend,
        mutation,
        need,
        wrap,
        json,
        fields,
        http,
        audit: (request, action, entityType, entityId, metadata) => audit(ctx, request, action, entityType, entityId, metadata),
    }));
    router.use((error, request, response, _next) => {
        const status = error.status && error.status >= 400 && error.status <= 599 ? error.status : 500;
        if (request.path === "/public/subscribe" || request.path === "/public/subscribe/confirm" ||
            request.path === "/public/unsubscribe" || request.path === "/public/subscription-status" ||
            /^\/public\/lists\/[^/]+\/subscription-customization$/.test(request.path)) {
            // Log a bounded reason category only: no address, token, query string, or DB exception text.
            if (status >= 500) {
                const reason = error.message === "No delivery provider is configured for double opt-in" ? "optin_provider_missing"
                    : error.message === "Confirmation queue is at capacity" ? "optin_queue_full"
                        : error.message === "Not installed" ? "installation_missing" : "unexpected_failure";
                console.error("Public subscription unavailable", { route: request.path.replace(/\/public\/lists\/[^/]+/, "/public/lists/:listId"), reason });
            }
            response.status(status).json(publicSubscriptionFailure(status, request.path));
            return;
        }
        response.status(status).json({
            error: status === 500 ? "Internal server error" : error.message,
            ...(error.code ? { code: error.code } : {}),
            ...(error.requestId ? { requestId: error.requestId } : {}),
            ...(error.requiredScopes ? { requiredScopes: error.requiredScopes } : {}),
        });
    });
    return router;
}
export function startCampaignsWorker(options = {}) {
    const intervalMs = options.intervalMs ?? 5000;
    if (!Number.isFinite(intervalMs) || intervalMs < 1000)
        throw new Error("Campaign worker interval must be at least 1000ms");
    const pool = options.pool ?? new Pool({ connectionString: options.databaseUrl ?? process.env.DATABASE_URL, max: 4 });
    const ownsPool = options.pool === undefined;
    let working = false;
    let stopped = false;
    const timer = setInterval(() => {
        if (working || stopped)
            return;
        working = true;
        runCampaignsWorker({ ...options, pool }).catch(error => options.onError?.(error)).finally(() => { working = false; });
    }, intervalMs);
    timer.unref();
    return {
        async stop() {
            if (stopped)
                return;
            stopped = true;
            clearInterval(timer);
            while (working)
                await new Promise(resolve => setTimeout(resolve, 10));
            if (ownsPool)
                await pool.end();
        },
    };
}
function deliveryConfig(provider, secret) {
    let credentials = {};
    try {
        credentials = json(JSON.parse(secret));
    }
    catch {
        credentials = { password: secret };
    }
    const metadata = (provider.metadata && typeof provider.metadata === "object" ? provider.metadata : {});
    if (provider.type === "smtp")
        return { type: "smtp", host: String(provider.host), port: Number(provider.port), username: provider.username ? String(provider.username) : undefined, password: String(credentials.password ?? secret), secure: metadata.secure === true, requireTls: metadata.requireTls !== false, allowPrivateHost: metadata.allowPrivateHost === true };
    if (provider.type === "ses")
        return { type: "ses", region: String(credentials.region ?? metadata.region), accessKeyId: String(credentials.accessKeyId ?? provider.username), secretAccessKey: String(credentials.secretAccessKey ?? secret), ...(credentials.sessionToken ? { sessionToken: String(credentials.sessionToken) } : {}), ...(credentials.configurationSetName ?? metadata.configurationSetName ? { configurationSetName: String(credentials.configurationSetName ?? metadata.configurationSetName) } : {}), ...(Array.isArray(metadata.snsTopicArns) ? { snsTopicArns: metadata.snsTopicArns.filter((topic) => typeof topic === "string") } : {}) };
    if (provider.type === "mailjet")
        return {
            type: "mailjet",
            apiKey: String(credentials.apiKey ?? provider.username),
            secretKey: String(credentials.secretKey ?? secret),
            ...(metadata.transport === "smtp" ? { transport: "smtp" } : {}),
            ...(metadata.smtpPort === 465 || metadata.smtpPort === 587 ? { smtpPort: metadata.smtpPort } : {}),
        };
    if (provider.type === "smtpcom")
        return { type: "smtpcom", apiKey: String(credentials.apiKey ?? secret), channel: String(credentials.channel ?? metadata.channel ?? provider.username) };
    if (provider.type === "sendgrid")
        return { type: "sendgrid", apiKey: String(credentials.apiKey ?? secret) };
    if (provider.type === "mailgun")
        return { type: "mailgun", apiKey: String(credentials.apiKey ?? secret), domain: String(credentials.domain ?? metadata.domain ?? provider.username), ...(metadata.region === "eu" ? { region: "eu" } : { region: "us" }) };
    if (provider.type === "postmark")
        return { type: "postmark", serverToken: String(credentials.serverToken ?? credentials.apiKey ?? secret), ...(metadata.transport === "smtp" ? { transport: "smtp" } : {}) };
    if (provider.type === "resend")
        return { type: "resend", apiKey: String(credentials.apiKey ?? secret) };
    if (provider.type === "brevo")
        return { type: "brevo", apiKey: String(credentials.apiKey ?? secret) };
    throw http(400, `Unsupported delivery provider type: ${String(provider.type)}`);
}
export async function runCampaignsWorker(options = {}) {
    const db = options.pool ?? new Pool({ connectionString: options.databaseUrl ?? campaignsDatabaseUrl(), max: 4 });
    await migrate(db);
    // Run on every scheduled tick, before delivery locks, automations, activation
    // checks or empty-queue returns. No user traffic or billable calls required.
    await cleanupCampaignInsightRetention(db, options.now?.() ?? new Date());
    const lockClient = await db.connect?.();
    if (!lockClient)
        throw new Error("Campaigns worker requires a lock-capable PostgreSQL pool");
    await lockClient.query("SELECT pg_advisory_lock($1)", [DELIVERY_RESTORE_LOCK]);
    try {
        await advanceAutomations(db);
        const result = await runCampaignsWorkerLocked(options, db);
        await advanceAutomations(db);
        return result;
    }
    finally {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [DELIVERY_RESTORE_LOCK]);
        lockClient.release();
    }
}
async function runCampaignsWorkerLocked(options, db) {
    const dataDir = options.dataDir ?? process.env.CAMPAIGNS_DATA_DIR ?? join(process.cwd(), ".campaigns-data");
    const key = secureFile(join(dataDir, "credential-key"), 32), sender = options.send ?? sendMessage, batch = Math.max(1, Math.min(100, options.batchSize ?? 10));
    const connectionRow = await db.query("SELECT connection_secret,connection FROM campaigns.installation");
    if (!connectionRow.rows[0])
        return { claimed: 0, sent: 0, rejected: 0, unknown: 0 };
    const connectionState = connectionRow.rows[0].connection;
    const stale = Date.now() - new Date(String(connectionState.lastCheckedAt ?? 0)).getTime() >= (options.activationRevalidateMs ?? 15 * 60 * 1000);
    if (stale || connectionState.connected !== true) {
        try {
            const activation = await (options.bridgeFactory ?? ((apiKey) => new SendReputeClient({ secret: apiKey })))(decrypted(key, connectionRow.rows[0].connection_secret)).validateActivation();
            await db.query("UPDATE campaigns.installation SET connection=connection||$1::jsonb", [{ connected: true, error: null, lastCheckedAt: new Date().toISOString(), activation }]);
        }
        catch (error) {
            const status = Number(error.status), revoked = status === 401 || status === 403;
            await db.query("UPDATE campaigns.installation SET connection=connection||$1::jsonb", [{ connected: false, error: revoked ? "Activation revoked" : "Activation service unavailable", lastCheckedAt: new Date().toISOString() }]);
            throw new Error(revoked ? "Campaign delivery blocked: activation revoked" : "Campaign delivery blocked: activation unavailable");
        }
    }
    const staleJobs = await db.query(`UPDATE campaigns.jobs SET state='unknown',updated_at=now(),revision=revision+1,
       last_error_code='STALE_SENDING',last_error_message='Worker stopped after transport began; outcome is ambiguous'
     WHERE state='sending' AND claimed_at<now()-($1||' minutes')::interval
     RETURNING id,campaign_id,recipient_id,attempt_count`, [String(options.staleSendingMinutes ?? 15)]);
    for (const staleJob of staleJobs.rows) {
        await appendDeliveryEvent(db, {
            jobId: staleJob.id, campaignId: staleJob.campaign_id, recipientId: staleJob.recipient_id,
            type: "unknown", source: "system", attempt: staleJob.attempt_count,
            errorCode: "STALE_SENDING",
        });
    }
    const client = await db.connect?.();
    if (!client)
        throw new Error("Campaigns worker requires a transaction-capable PostgreSQL pool");
    let jobs = [];
    try {
        await client.query("BEGIN");
        const claimed = await client.query("SELECT j.id,j.campaign_id,j.recipient_id,j.kind,j.snapshot,j.attempt_count,j.max_attempts FROM campaigns.jobs j WHERE j.state='queued' AND j.run_at<=now() AND (j.kind IN ('optin','test','subscription') OR (j.kind='automation' AND EXISTS(SELECT 1 FROM campaigns.automation_runs r JOIN campaigns.automations a ON a.id=r.automation_id WHERE r.id=j.automation_run_id AND r.state='running' AND a.status='active')) OR (j.kind='campaign' AND EXISTS(SELECT 1 FROM campaigns.entities e WHERE e.kind='campaigns' AND e.id=j.campaign_id AND e.body->>'status' IN ('sending','scheduled')))) ORDER BY j.run_at FOR UPDATE SKIP LOCKED LIMIT $1", [batch]);
        jobs = claimed.rows;
        if (jobs.length)
            await client.query("UPDATE campaigns.jobs SET state='sending',claimed_at=now(),updated_at=now(),revision=revision+1 WHERE id=ANY($1::uuid[])", [jobs.map(j => j.id)]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
    for (const campaignId of [...new Set(jobs.filter(job => job.kind === "campaign" && job.campaign_id).map(job => job.campaign_id))]) {
        await db.query(`UPDATE campaigns.entities SET body=jsonb_set(body,'{status}','"sending"'::jsonb),updated_at=now()
       WHERE kind='campaigns' AND id=$1 AND body->>'status'='scheduled'`, [campaignId]);
        const campaign = jobs.find(job => job.campaign_id === campaignId)?.snapshot.campaign;
        const campaignName = String(campaign?.name ?? campaignId);
        await enqueueCampaignNotification(db, {
            campaignId,
            type: "started",
            dedupeKey: `campaign:${campaignId}:started`,
            campaignName,
            text: `Campaign "${campaignName}" started.`,
        });
    }
    let sent = 0, rejected = 0, unknown = 0;
    for (const job of jobs) {
        const snapshot = job.snapshot, campaign = snapshot.campaign, subscriber = snapshot.subscriber, template = snapshot.template;
        const audience = snapshot.audience && typeof snapshot.audience === "object" ? snapshot.audience : {};
        const snapshotScope = typeof audience.scope === "string" ? audience.scope
            : typeof subscriber?.scope === "string" ? subscriber.scope : null;
        // An identified recipient belongs to its own scope: a held address in a
        // different scope must not suppress it. Only legacy jobs without a recipient
        // ID need an address fallback, bounded by their scope whenever it is known.
        const identityHold = job.recipient_id
            ? await db.query("SELECT 1 FROM campaigns.subscriber_reconciliations WHERE subscriber_id=$1", [job.recipient_id])
            : await db.query("SELECT 1 FROM campaigns.subscriber_reconciliations WHERE lower(btrim(original_entity->'body'->>'email'))=lower(btrim($1::text)) AND ($2::text IS NULL OR original_entity->'body'->>'scope'=$2) LIMIT 1", [typeof subscriber?.email === "string" ? subscriber.email : null, snapshotScope]);
        if (identityHold.rowCount) {
            await db.query("UPDATE campaigns.jobs SET state='cancelled',updated_at=now(),revision=revision+1 WHERE id=$1 AND state='sending'", [job.id]);
            await appendDeliveryEvent(db, { jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id, type: "cancelled", source: "worker", metadata: { reason: "reconciled_identity_hold" } });
            continue;
        }
        if (job.recipient_id) {
            const live = await db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1 AND ($2::text IS NULL OR body->>'scope'=$2) AND NOT EXISTS (SELECT 1 FROM campaigns.subscriber_reconciliations WHERE subscriber_id=$1)", [job.recipient_id, snapshotScope]);
            const goodbye = job.kind === "subscription" && snapshot.subscription?.kind === "goodbye";
            if (!live.rows[0] || (!goodbye && live.rows[0].body.status !== "subscribed")) {
                await db.query("UPDATE campaigns.jobs SET state='cancelled',updated_at=now(),revision=revision+1 WHERE id=$1 AND state='sending'", [job.id]);
                await appendDeliveryEvent(db, { jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id, type: "cancelled", source: "worker", metadata: { reason: "recipient_suppressed" } });
                continue;
            }
        }
        const providerId = String(campaign.providerId ?? snapshot.providerId), found = await db.query("SELECT body,secret FROM campaigns.entities WHERE kind='providers' AND id=$1 AND body->>'enabled'='true'", [providerId]);
        if (!found.rows[0]?.secret) {
            await db.query("UPDATE campaigns.jobs SET state='rejected',last_error_code='PROVIDER_UNAVAILABLE',last_error_message='Provider unavailable',updated_at=now(),revision=revision+1 WHERE id=$1", [job.id]);
            await appendDeliveryEvent(db, { jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id, type: "rejected", source: "worker", errorCode: "PROVIDER_UNAVAILABLE" });
            rejected++;
            continue;
        }
        const provider = found.rows[0].body, rate = Math.max(1, Math.min(10000, Number(provider.metadata?.ratePerMinute ?? 60)));
        const used = await db.query("INSERT INTO campaigns.rate_limits(provider_id,bucket,used) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(provider_id,bucket) DO UPDATE SET used=campaigns.rate_limits.used+1 RETURNING used", [providerId]);
        if ((used.rows[0]?.used ?? 1) > rate) {
            await db.query("UPDATE campaigns.jobs SET state='queued',claimed_at=NULL,run_at=date_trunc('minute',now())+interval '1 minute' WHERE id=$1", [job.id]);
            continue;
        }
        try {
            const attempt = job.attempt_count + 1;
            await db.query("UPDATE campaigns.jobs SET attempt_count=$2,updated_at=now() WHERE id=$1 AND state='sending'", [job.id, attempt]);
            await appendDeliveryEvent(db, {
                jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                type: "worker_attempt", source: "worker", attempt,
            });
            const settings = await db.query("SELECT settings FROM campaigns.installation");
            const marketing = job.kind === "campaign" || job.kind === "automation";
            if (marketing && (!job.recipient_id || !Array.isArray(subscriber.listIds) || !subscriber.listIds.length ||
                typeof subscriber.email !== "string")) {
                throw Object.assign(new Error("A recipient unsubscribe link is required"), { deliveryState: "not-sent", code: "UNSUBSCRIBE_UNAVAILABLE" });
            }
            const baseUrl = marketing || job.recipient_id && Array.isArray(subscriber.listIds) && subscriber.listIds.length
                ? deliveryPublicUrl(settings.rows[0]?.settings.publicUrl) : undefined;
            let token;
            if (baseUrl && job.recipient_id && Array.isArray(subscriber.listIds) && subscriber.listIds.length) {
                token = randomBytes(32).toString("base64url");
                await db.query("INSERT INTO campaigns.tokens(token_hash,purpose,subscriber_id,list_id,email,expires_at) VALUES($1,'unsubscribe',$2,$3,$4,now()+interval '180 days')", [hash(token), job.recipient_id, subscriber.listIds[0], subscriber.email]);
            }
            const unsubscribe = token ? (() => {
                const url = publicCampaignsPageUrl(baseUrl, "unsubscribe");
                url.searchParams.set("token", token);
                return url.toString();
            })() : undefined;
            const oneClickUnsubscribe = unsubscribe ? (() => {
                const value = new URL(unsubscribe);
                value.searchParams.set("oneClick", "1");
                return value.toString();
            })() : undefined;
            let rendered = unsubscribe
                ? populateUnsubscribeContent(String(template.html ?? ""), String(template.text ?? ""), unsubscribe)
                : { html: String(template.html ?? ""), text: String(template.text ?? "") };
            if (job.kind === "campaign" && job.campaign_id) {
                const tracking = snapshot.tracking && typeof snapshot.tracking === "object" ? snapshot.tracking : null;
                if (tracking?.html && typeof tracking.html === "string") {
                    rendered = { html: tracking.html, text: typeof tracking.text === "string" ? tracking.text : rendered.text };
                }
                else {
                    const hrefs = [...rendered.html.matchAll(/\bhref=(["'])(https?:\/\/[^"'<>]+)\1/gi)]
                        .map(match => match[2])
                        .filter(url => !unsubscribe || !url.startsWith(unsubscribe))
                        .slice(0, 200);
                    const links = await createCampaignTrackingLinks(db, {
                        signingKey: key, installationPublicUrl: String(settings.rows[0]?.settings.publicUrl),
                        domainId: typeof campaign.metadata?.trackingDomainId === "string" ? String(campaign.metadata.trackingDomainId) : null,
                        jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                        subject: String(campaign.subject ?? template.subject), html: rendered.html, text: rendered.text,
                        trackingEnabled: settings.rows[0]?.settings.trackingEnabled !== false,
                        recipientTrackingOptOut: subscriber.metadata?.trackingOptOut === true,
                        clicks: hrefs.map((url, index) => ({ key: String(index), url })),
                    });
                    let html = rendered.html;
                    for (let index = 0; index < hrefs.length; index++)
                        html = html.replace(hrefs[index], links.clicks[index].url);
                    html += `<p><a href="${escapeHtmlAttribute(links.webVersionUrl)}">View in browser</a></p>`;
                    if (links.openUrl)
                        html += `<img src="${escapeHtmlAttribute(links.openUrl)}" width="1" height="1" alt="">`;
                    rendered = { html, text: `${rendered.text}\n\nView in browser: ${links.webVersionUrl}` };
                    snapshot.tracking = { documentId: links.documentId, html: rendered.html, text: rendered.text };
                    await db.query("UPDATE campaigns.jobs SET snapshot=$2,updated_at=now() WHERE id=$1 AND state='sending'", [job.id, snapshot]);
                }
            }
            const result = await sender(deliveryConfig(provider, decrypted(key, found.rows[0].secret)), {
                id: job.id,
                from: { email: String(campaign.fromEmail), name: String(campaign.fromName) },
                to: { email: String(subscriber.email), ...(subscriber.firstName ? { name: String(subscriber.firstName) } : {}) },
                subject: String(campaign.subject ?? template.subject),
                html: rendered.html,
                text: rendered.text,
                ...(oneClickUnsubscribe ? { headers: {
                        "List-Unsubscribe": `<${oneClickUnsubscribe}>`,
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    } } : {}),
            });
            await db.query("UPDATE campaigns.jobs SET state='sent',provider_message_id=$2,next_attempt_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=now(),revision=revision+1 WHERE id=$1 AND state='sending'", [job.id, result.providerMessageId ?? null]);
            await appendDeliveryEvent(db, {
                jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                type: "accepted", source: "worker", attempt, providerMessageId: result.providerMessageId,
            });
            sent++;
            if (job.kind === "campaign" && job.campaign_id)
                await refreshCampaignDeliveryStatistics(db, job.campaign_id);
            if (job.kind === "automation") {
                const automation = await db.query("SELECT automation_id FROM campaigns.automation_runs WHERE job_id=$1", [job.id]);
                const automationId = automation.rows[0]?.automation_id;
                if (automationId)
                    await recordRuleEvent(db, { eventId: `job:${job.id}:sent`, type: "automation.sent", automationId, subscriberId: job.recipient_id ?? undefined, listIds: subscriber.listIds ?? [] });
            }
        }
        catch (error) {
            const failure = error;
            const attempt = job.attempt_count + 1;
            const safeMessage = String(failure.message ?? "Delivery failed").slice(0, 500);
            if (failure.deliveryState === "not-sent" && failure.retryable === true && attempt < job.max_attempts) {
                const delaySeconds = Math.min(3600, 30 * (2 ** (attempt - 1)));
                await db.query("UPDATE campaigns.jobs SET state='queued',claimed_at=NULL,run_at=now()+($2||' seconds')::interval,next_attempt_at=now()+($2||' seconds')::interval,last_error_code=$3,last_error_message=$4,updated_at=now(),revision=revision+1 WHERE id=$1 AND state='sending'", [job.id, String(delaySeconds), failure.code ?? "TRANSIENT_NOT_SENT", safeMessage]);
                await appendDeliveryEvent(db, {
                    jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                    type: "retry_scheduled", source: "worker", attempt, errorCode: failure.code ?? "TRANSIENT_NOT_SENT",
                    metadata: { delaySeconds },
                });
            }
            else {
                const state = failure.deliveryState === "not-sent" || failure.deliveryState === "rejected" ? "rejected" : "unknown";
                await db.query("UPDATE campaigns.jobs SET state=$2,last_error_code=$3,last_error_message=$4,updated_at=now(),revision=revision+1 WHERE id=$1 AND state='sending'", [job.id, state, failure.code ?? "DELIVERY_FAILED", safeMessage]);
                await appendDeliveryEvent(db, {
                    jobId: job.id, campaignId: job.campaign_id, recipientId: job.recipient_id,
                    type: state, source: "worker", attempt, errorCode: failure.code ?? "DELIVERY_FAILED",
                });
                if (state === "unknown")
                    unknown++;
                else
                    rejected++;
            }
        }
    }
    const failedCampaigns = await db.query("UPDATE campaigns.entities e SET body=jsonb_set(e.body,'{status}','\"failed\"'::jsonb),updated_at=now() WHERE e.kind='campaigns' AND e.body->>'status'='sending' AND NOT EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign' AND j.state IN ('queued','sending')) AND EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign' AND j.state IN ('rejected','unknown')) RETURNING e.id,e.body");
    for (const campaign of failedCampaigns.rows) {
        const name = String(campaign.body.name ?? campaign.id);
        await enqueueCampaignNotification(db, {
            campaignId: campaign.id, type: "failed", dedupeKey: `campaign:${campaign.id}:failed`,
            campaignName: name,
            text: `Campaign "${name}" failed. Some outcomes may be unknown; review delivery events before retrying.`,
        });
    }
    const completedCampaigns = await db.query("UPDATE campaigns.entities e SET body=jsonb_set(e.body,'{status}','\"sent\"'::jsonb),updated_at=now() WHERE e.kind='campaigns' AND e.body->>'status'='sending' AND EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign') AND NOT EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign' AND j.state IN ('queued','sending','rejected','unknown')) RETURNING e.id,e.body");
    for (const campaign of completedCampaigns.rows) {
        const name = String(campaign.body.name ?? campaign.id);
        const accepted = Number(campaign.body.statistics?.sent ?? 0);
        await enqueueCampaignNotification(db, {
            campaignId: campaign.id, type: "completed", dedupeKey: `campaign:${campaign.id}:completed`,
            campaignName: name,
            text: `Campaign "${name}" completed with ${accepted} message(s) accepted by the provider. Acceptance does not confirm inbox delivery.`,
        });
        await recordRuleEvent(db, { eventId: `campaign:${campaign.id}:sent`, type: "campaign.sent", campaignId: campaign.id, campaignName: name, listIds: campaign.body.listIds ?? [] });
    }
    await runRulesWebhookWorker({
        db, key, decrypt: decrypted,
        authorizeListAction: async (ruleId, targetListId) => {
            const rule = await db.query("SELECT trigger_list_id FROM campaigns.event_rules WHERE id=$1", [ruleId]);
            return !!rule.rows[0] && (rule.rows[0].trigger_list_id === null || rule.rows[0].trigger_list_id === targetListId);
        },
        enqueueEmail: async (message) => {
            const [settings, provider] = await Promise.all([
                db.query("SELECT settings FROM campaigns.installation WHERE singleton=true"),
                db.query("SELECT id FROM campaigns.entities WHERE kind='providers' AND body->>'enabled'='true' AND secret IS NOT NULL ORDER BY created_at LIMIT 1"),
            ]);
            if (!settings.rows[0] || !provider.rows[0])
                throw Object.assign(new Error("No provider is configured for rule email"), { code: "RULE_EMAIL_PROVIDER" });
            const id = randomUUID();
            await db.query("INSERT INTO campaigns.jobs(id,kind,state,run_at,snapshot) VALUES($1,'test','queued',now(),$2)", [id, {
                    providerId: provider.rows[0].id,
                    campaign: { providerId: provider.rows[0].id, fromName: settings.rows[0].settings.defaultFromName, fromEmail: settings.rows[0].settings.defaultFromEmail, subject: message.subject },
                    template: { subject: message.subject, html: `<p>${message.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`, text: message.text },
                    subscriber: { email: message.to },
                    rule: { idempotencyKey: message.idempotencyKey },
                }]);
        },
    });
    await runTelegramNotificationWorker({
        db,
        key,
        decrypt: decrypted,
        sender: options.telegramSend ?? sendTelegramMessage,
    });
    return { claimed: jobs.length, sent, rejected, unknown };
}
async function scopedSubscriber(tx, scope, address) {
    const result = await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1 AND lower(btrim(body->>'email'))=$2 FOR UPDATE", [scope, email(address)]);
    return result.rows[0]?.body;
}
async function subscriberTransaction(db, work) {
    const client = await db.connect?.(), tx = client ?? db;
    try {
        await tx.query("BEGIN");
        await lockSubscribers(tx);
        const result = await work(tx);
        await tx.query("COMMIT");
        return result;
    }
    catch (error) {
        await tx.query("ROLLBACK");
        throw error;
    }
    finally {
        client?.release();
    }
}
//# sourceMappingURL=index.js.map