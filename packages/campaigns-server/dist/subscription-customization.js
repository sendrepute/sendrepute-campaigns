import { randomUUID } from "node:crypto";
import { Router } from "express";
const PAGE_KEYS = [
    "subscribeTitle", "subscribeMessage", "pendingTitle", "pendingMessage",
    "confirmedTitle", "confirmedMessage", "unsubscribeTitle", "unsubscribeMessage",
    "goodbyeTitle", "goodbyeMessage",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(status, message) {
    return Object.assign(new Error(message), { status });
}
function record(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw failure(400, `${name} must be an object`);
    return value;
}
function exact(value, allowed, name) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw failure(400, `${name} contains an unsupported field`);
}
function safeText(value, name, maximum) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value !== "string" || value.length > maximum || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
        throw failure(400, `${name} must be safe plain text of at most ${maximum} characters`);
    }
    return value;
}
function parsePage(value) {
    const input = record(value ?? {}, "pageContent");
    exact(input, PAGE_KEYS, "pageContent");
    return Object.fromEntries(PAGE_KEYS.map(key => [key, safeText(input[key], `pageContent.${key}`, key.endsWith("Title") ? 120 : 1000)]));
}
function parseForm(value) {
    const input = record(value ?? {}, "form");
    exact(input, ["showFirstName", "showLastName", "submitLabel"], "form");
    for (const key of ["showFirstName", "showLastName"]) {
        if (input[key] !== undefined && typeof input[key] !== "boolean")
            throw failure(400, `form.${key} must be a boolean`);
    }
    return {
        showFirstName: input.showFirstName !== false,
        showLastName: input.showLastName !== false,
        submitLabel: safeText(input.submitLabel, "form.submitLabel", 80),
    };
}
function parseMail(value, name) {
    const input = record(value ?? {}, name);
    exact(input, ["enabled", "templateId", "providerId"], name);
    if (input.enabled !== undefined && typeof input.enabled !== "boolean")
        throw failure(400, `${name}.enabled must be a boolean`);
    const enabled = input.enabled === true;
    const templateId = input.templateId == null ? null : String(input.templateId);
    const providerId = input.providerId == null ? null : String(input.providerId);
    if ((templateId && !UUID.test(templateId)) || (providerId && !UUID.test(providerId)))
        throw failure(400, `${name} references must be UUIDs`);
    if (enabled && (!templateId || !providerId))
        throw failure(400, `${name} templateId and providerId are required when enabled`);
    return { enabled, templateId, providerId };
}
function empty(listId) {
    return {
        listId,
        pageContent: parsePage({}),
        form: parseForm({}),
        optInMode: null,
        welcome: { enabled: false, templateId: null, providerId: null },
        goodbye: { enabled: false, templateId: null, providerId: null },
    };
}
function fromRow(row, listId) {
    if (!row)
        return empty(listId);
    return {
        listId,
        pageContent: parsePage(row.page_content),
        form: parseForm(row.form_config),
        optInMode: row.opt_in_mode,
        welcome: { enabled: row.welcome_enabled, templateId: row.welcome_template_id, providerId: row.welcome_provider_id },
        goodbye: { enabled: row.goodbye_enabled, templateId: row.goodbye_template_id, providerId: row.goodbye_provider_id },
    };
}
export async function getSubscriptionCustomization(db, listId) {
    const result = await db.query(`SELECT list_id,page_content,form_config,opt_in_mode,welcome_enabled,welcome_template_id,welcome_provider_id,
       goodbye_enabled,goodbye_template_id,goodbye_provider_id
     FROM campaigns.subscription_customizations WHERE list_id=$1`, [listId]);
    return fromRow(result.rows[0], listId);
}
export async function resolveListDoubleOptIn(db, listId, installationDefault) {
    const config = await getSubscriptionCustomization(db, listId);
    return config.optInMode === null ? installationDefault : config.optInMode === "double";
}
export function createSubscriptionCustomizationRouter(deps) {
    const router = Router();
    router.get("/lists/:listId/subscription-customization", deps.need("lists:manage"), deps.wrap(async (request, response) => {
        const listId = String(request.params.listId);
        if (!UUID.test(listId))
            throw failure(400, "Invalid list ID");
        await deps.assertListAllowed(request, listId);
        if (!(await deps.db.query("SELECT 1 FROM campaigns.entities WHERE kind='lists' AND id=$1", [listId])).rowCount)
            throw failure(404, "List not found");
        response.json({ data: await getSubscriptionCustomization(deps.db, listId) });
    }));
    router.put("/lists/:listId/subscription-customization", deps.mutation, deps.need("lists:manage"), deps.wrap(async (request, response) => {
        const listId = String(request.params.listId);
        if (!UUID.test(listId))
            throw failure(400, "Invalid list ID");
        await deps.assertListAllowed(request, listId);
        if (!(await deps.db.query("SELECT 1 FROM campaigns.entities WHERE kind='lists' AND id=$1", [listId])).rowCount)
            throw failure(404, "List not found");
        const body = record(request.body, "body");
        exact(body, ["pageContent", "form", "optInMode", "welcome", "goodbye"], "body");
        const page = parsePage(body.pageContent);
        const form = parseForm(body.form);
        if (body.optInMode !== null && body.optInMode !== "single" && body.optInMode !== "double")
            throw failure(400, "optInMode must be single, double, or null");
        const welcome = parseMail(body.welcome, "welcome");
        const goodbye = parseMail(body.goodbye, "goodbye");
        for (const [kind, mail] of [["welcome", welcome], ["goodbye", goodbye]]) {
            if (!mail.enabled)
                continue;
            const references = await deps.db.query(`SELECT EXISTS(SELECT 1 FROM campaigns.entities WHERE kind='templates' AND id=$1) template_ok,
                EXISTS(SELECT 1 FROM campaigns.entities WHERE kind='providers' AND id=$2 AND body->>'enabled'='true' AND secret IS NOT NULL) provider_ok`, [mail.templateId, mail.providerId]);
            if (!references.rows[0]?.template_ok || !references.rows[0].provider_ok)
                throw failure(400, `${kind} template or enabled provider was not found`);
        }
        await deps.db.query(`INSERT INTO campaigns.subscription_customizations(
         list_id,brand_scope,page_content,form_config,opt_in_mode,welcome_enabled,welcome_template_id,welcome_provider_id,
         goodbye_enabled,goodbye_template_id,goodbye_provider_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(list_id) DO UPDATE SET brand_scope=excluded.brand_scope,page_content=excluded.page_content,
         form_config=excluded.form_config,opt_in_mode=excluded.opt_in_mode,welcome_enabled=excluded.welcome_enabled,
         welcome_template_id=excluded.welcome_template_id,welcome_provider_id=excluded.welcome_provider_id,
         goodbye_enabled=excluded.goodbye_enabled,goodbye_template_id=excluded.goodbye_template_id,
         goodbye_provider_id=excluded.goodbye_provider_id,updated_at=now()`, [listId, await deps.brandScope(), page, form, body.optInMode, welcome.enabled, welcome.templateId, welcome.providerId,
            goodbye.enabled, goodbye.templateId, goodbye.providerId]);
        await deps.audit(request, "list.subscription_customization.update", "lists", listId, {
            optInMode: body.optInMode, welcomeEnabled: welcome.enabled, goodbyeEnabled: goodbye.enabled,
        });
        response.json({ data: { listId, pageContent: page, form, optInMode: body.optInMode, welcome, goodbye } });
    }));
    router.get("/public/lists/:listId/subscription-customization", deps.wrap(async (request, response) => {
        const listId = String(request.params.listId);
        const token = String(request.query.token ?? "");
        if (!UUID.test(listId) || token.length < 16 || !(await deps.verifyListToken(listId, token)))
            throw failure(400, "Invalid subscription link");
        const list = await deps.db.query("SELECT body FROM campaigns.entities WHERE kind='lists' AND id=$1", [listId]);
        if (!list.rows[0])
            throw failure(404, "List not found");
        const config = await getSubscriptionCustomization(deps.db, listId);
        const installation = await deps.db.query("SELECT settings FROM campaigns.installation");
        if (!installation.rows[0])
            throw failure(503, "Not installed");
        const optInMode = config.optInMode ?? (installation.rows[0].settings.doubleOptIn === false ? "single" : "double");
        response.json({ data: {
                list: { id: listId, name: String(list.rows[0].body.name ?? "") },
                pageContent: config.pageContent,
                optInMode,
                form: { ...config.form, action: deps.publicSubscribePath ?? "/public/subscribe", method: "POST", listId, listToken: token },
                embed: {
                    src: deps.publicCustomizationPath?.(listId, token)
                        ?? `/public/lists/${encodeURIComponent(listId)}/subscription-customization?token=${encodeURIComponent(token)}`,
                },
            } });
    }));
    return router;
}
async function queueConfiguredMail(deps, event, kind) {
    if (!UUID.test(event.listId) || !UUID.test(event.subscriberId) || !event.consentEpoch || event.consentEpoch.length > 200) {
        throw failure(400, "Invalid subscription mail event");
    }
    const subscriber = await deps.db.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1 AND NOT EXISTS (SELECT 1 FROM campaigns.subscriber_reconciliations WHERE subscriber_id=$1)", [event.subscriberId]);
    const body = subscriber.rows[0]?.body;
    if (!body || body.status === "complained" || body.status === "bounced" || body.hardBounced === true || body.complained === true)
        return false;
    const suppression = await deps.db.query(`SELECT EXISTS(
       SELECT 1 FROM campaigns.delivery_events
       WHERE recipient_id=$1 AND event_type IN ('provider_bounced','provider_complained')
     ) suppressed`, [event.subscriberId]);
    if (suppression.rows[0]?.suppressed)
        return false;
    if (kind === "welcome" && (body.status !== "subscribed" || !Array.isArray(body.listIds) || !body.listIds.includes(event.listId)))
        return false;
    const config = await getSubscriptionCustomization(deps.db, event.listId);
    const mail = config[kind];
    if (!mail.enabled || !mail.templateId || !mail.providerId)
        return false;
    const id = randomUUID();
    const inserted = await deps.db.query(`INSERT INTO campaigns.subscription_mail_events(id,list_id,subscriber_id,event_type,consent_epoch,state)
     VALUES($1,$2,$3,$4,$5,'pending')
     ON CONFLICT(list_id,subscriber_id,event_type,consent_epoch) DO NOTHING RETURNING id`, [id, event.listId, event.subscriberId, kind, event.consentEpoch]);
    let eventId = inserted.rows[0]?.id;
    if (!eventId) {
        // A failed handoff may be retried with the same durable id. The queue hook
        // must use eventId as its dedupe key, covering an ambiguous prior handoff.
        const retry = await deps.db.query(`UPDATE campaigns.subscription_mail_events SET state='pending',last_error_code=NULL,updated_at=now()
       WHERE list_id=$1 AND subscriber_id=$2 AND event_type=$3 AND consent_epoch=$4 AND state='failed'
       RETURNING id`, [event.listId, event.subscriberId, kind, event.consentEpoch]);
        eventId = retry.rows[0]?.id;
    }
    if (!eventId)
        return false;
    try {
        await deps.enqueue({
            eventId, kind, listId: event.listId, subscriberId: event.subscriberId,
            templateId: mail.templateId, providerId: mail.providerId,
        });
        await deps.db.query("UPDATE campaigns.subscription_mail_events SET state='queued',queued_at=now(),updated_at=now() WHERE id=$1 AND state='pending'", [eventId]);
        return true;
    }
    catch (error) {
        await deps.db.query("UPDATE campaigns.subscription_mail_events SET state='failed',last_error_code=$2,updated_at=now() WHERE id=$1 AND state='pending'", [eventId, String(error.code ?? "QUEUE_ERROR").slice(0, 100)]);
        throw error;
    }
}
export async function onSubscribeConfirmed(deps, event) {
    return queueConfiguredMail(deps, event, "welcome");
}
export async function onUnsubscribe(deps, event) {
    if (event.reason !== "user" || event.previousStatus !== "subscribed")
        return false;
    return queueConfiguredMail(deps, event, "goodbye");
}
//# sourceMappingURL=subscription-customization.js.map