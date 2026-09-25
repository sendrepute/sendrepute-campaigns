import { createHmac } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Router } from "express";
const EVENT_TYPES = [
    "campaign.scheduled", "campaign.sending", "campaign.sent", "automation.sent", "list.joined",
];
const ACTION_TYPES = ["webhook", "unsubscribe", "email_notification"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function publicRule(row) {
    return {
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        trigger: { type: row.trigger_type, ...(row.trigger_list_id ? { listId: row.trigger_list_id } : {}) },
        action: {
            type: row.action_type,
            ...row.action_config,
            ...(row.action_type === "webhook" ? { secretConfigured: !!row.encrypted_secret } : {}),
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function publicDelivery(row) {
    return {
        id: row.id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        eventType: row.event_type,
        sourceEventId: row.source_event_id,
        state: row.state,
        attemptCount: row.attempt_count,
        availableAt: row.available_at,
        leaseUntil: row.lease_until,
        deliveredAt: row.delivered_at,
        lastErrorCode: row.last_error_code,
        createdAt: row.created_at,
    };
}
function webhookUrl(value) {
    if (typeof value !== "string" || value.length > 2048)
        throw fail(400, "Webhook URL is invalid");
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw fail(400, "Webhook URL is invalid");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.hash || isIP(url.hostname))
        throw fail(400, "Webhook URL must use public HTTPS on port 443");
    return url.href;
}
function validateDefinition(raw, existingSecret, encryptSecret) {
    if (!object(raw) || Object.keys(raw).some(key => !["name", "enabled", "trigger", "action"].includes(key))) {
        throw fail(400, "Invalid rule fields");
    }
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 120)
        throw fail(400, "Rule name required (max 120)");
    if (typeof raw.enabled !== "boolean")
        throw fail(400, "enabled must be a boolean");
    if (!object(raw.trigger) || Object.keys(raw.trigger).some(key => !["type", "listId"].includes(key)) ||
        !EVENT_TYPES.includes(raw.trigger.type))
        throw fail(400, "Invalid rule trigger");
    const triggerType = raw.trigger.type;
    const triggerListId = raw.trigger.listId === undefined ? null : String(raw.trigger.listId);
    if (triggerListId !== null && !UUID.test(triggerListId))
        throw fail(400, "Invalid trigger list ID");
    if (triggerType === "list.joined" && !triggerListId)
        throw fail(400, "list.joined requires a trigger list");
    if (!object(raw.action) || !ACTION_TYPES.includes(raw.action.type))
        throw fail(400, "Invalid rule action");
    const actionType = raw.action.type;
    let actionConfig;
    let encryptedSecret = null;
    if (actionType === "webhook") {
        if (Object.keys(raw.action).some(key => !["type", "url", "secret"].includes(key)))
            throw fail(400, "Invalid webhook action fields");
        const secret = raw.action.secret;
        if (secret !== undefined && (typeof secret !== "string" || secret.length < 16 || secret.length > 512))
            throw fail(400, "Webhook secret must be 16–512 characters");
        encryptedSecret = typeof secret === "string" ? encryptSecret(secret) : existingSecret;
        if (!encryptedSecret)
            throw fail(400, "Webhook secret is required");
        actionConfig = { url: webhookUrl(raw.action.url) };
    }
    else if (actionType === "unsubscribe") {
        if (Object.keys(raw.action).some(key => !["type", "listId"].includes(key)) || !UUID.test(String(raw.action.listId ?? ""))) {
            throw fail(400, "Unsubscribe action requires a valid listId");
        }
        actionConfig = { listId: raw.action.listId };
    }
    else {
        if (Object.keys(raw.action).some(key => !["type", "to", "subject"].includes(key)) ||
            typeof raw.action.to !== "string" || !EMAIL.test(raw.action.to) ||
            typeof raw.action.subject !== "string" || !raw.action.subject.trim() || raw.action.subject.length > 200) {
            throw fail(400, "Email notification requires a valid to and subject");
        }
        actionConfig = { to: raw.action.to, subject: raw.action.subject.trim() };
    }
    return { name: raw.name.trim(), enabled: raw.enabled, triggerType, triggerListId, actionType, actionConfig, encryptedSecret };
}
export function createRulesWebhooksRouter(deps) {
    const router = Router();
    const get = async (request) => {
        const id = String(request.params.id ?? "");
        if (!UUID.test(id))
            throw fail(400, "Invalid rule ID");
        const row = (await deps.db.query("SELECT * FROM campaigns.event_rules WHERE id=$1", [id])).rows[0];
        if (!row)
            throw fail(404, "Rule not found");
        if (!row.trigger_list_id && deps.restrictedLists(request) !== null)
            throw fail(403, "Permission denied");
        if (row.trigger_list_id)
            deps.assertListsAllowed(request, [row.trigger_list_id]);
        if (row.action_type === "unsubscribe")
            deps.assertListsAllowed(request, [row.action_config.listId]);
        return row;
    };
    const validate = (request, body, secret) => {
        const value = validateDefinition(body, secret, value => deps.encrypt(deps.key, value));
        if (!value.triggerListId && deps.restrictedLists(request) !== null)
            throw fail(403, "A list-scoped rule requires a trigger list");
        if (value.triggerListId)
            deps.assertListsAllowed(request, [value.triggerListId]);
        if (value.actionType === "unsubscribe")
            deps.assertListsAllowed(request, [value.actionConfig.listId]);
        return value;
    };
    router.get("/rules", deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const page = Math.max(1, Number(request.query.page ?? 1) || 1);
        const pageSize = Math.max(1, Math.min(100, Number(request.query.pageSize ?? 25) || 25));
        const allowed = deps.restrictedLists(request);
        const where = `($1::uuid[] IS NULL OR
      trigger_list_id IS NOT NULL AND trigger_list_id=ANY($1::uuid[]) AND
      (action_type<>'unsubscribe' OR (action_config->>'listId')::uuid=ANY($1::uuid[])))`;
        const rows = await deps.db.query(`SELECT * FROM campaigns.event_rules WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [allowed, pageSize, (page - 1) * pageSize]);
        const count = await deps.db.query(`SELECT count(*)::text count FROM campaigns.event_rules WHERE ${where}`, [allowed]);
        response.json({ data: rows.rows.map(publicRule), meta: { page, pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.post("/rules", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const value = validate(request, request.body, null);
        const row = (await deps.db.query(`INSERT INTO campaigns.event_rules(name,enabled,trigger_type,trigger_list_id,action_type,action_config,encrypted_secret)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [value.name, value.enabled, value.triggerType, value.triggerListId, value.actionType, value.actionConfig, value.encryptedSecret])).rows[0];
        await deps.audit(request, "rule.create", "event_rule", row.id, { triggerType: value.triggerType, actionType: value.actionType });
        response.status(201).json({ data: publicRule(row) });
    }));
    const deliveryScope = `($1::uuid[] IS NULL OR
    r.trigger_list_id IS NOT NULL AND r.trigger_list_id=ANY($1::uuid[]) AND
    (r.action_type<>'unsubscribe' OR (r.action_config->>'listId')::uuid=ANY($1::uuid[])))`;
    router.get("/rules/deliveries", deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const page = Math.max(1, Number(request.query.page ?? 1) || 1);
        const pageSize = Math.max(1, Math.min(100, Number(request.query.pageSize ?? 25) || 25));
        const allowed = deps.restrictedLists(request);
        const rows = await deps.db.query(`SELECT o.*,r.name rule_name FROM campaigns.rule_outbox o
       JOIN campaigns.event_rules r ON r.id=o.rule_id WHERE ${deliveryScope}
       ORDER BY o.created_at DESC,o.id DESC LIMIT $2 OFFSET $3`, [allowed, pageSize, (page - 1) * pageSize]);
        const count = await deps.db.query(`SELECT count(*)::text count FROM campaigns.rule_outbox o
       JOIN campaigns.event_rules r ON r.id=o.rule_id WHERE ${deliveryScope}`, [allowed]);
        response.json({ data: rows.rows.map(publicDelivery), meta: { page, pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.get("/rules/:id", deps.need("settings:manage"), deps.wrap(async (request, response) => {
        response.json({ data: publicRule(await get(request)) });
    }));
    router.put("/rules/:id", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const old = await get(request);
        const value = validate(request, request.body, old.action_type === "webhook" ? old.encrypted_secret : null);
        const row = (await deps.db.query(`UPDATE campaigns.event_rules SET name=$2,enabled=$3,trigger_type=$4,trigger_list_id=$5,
       action_type=$6,action_config=$7,encrypted_secret=$8,updated_at=now() WHERE id=$1 RETURNING *`, [old.id, value.name, value.enabled, value.triggerType, value.triggerListId, value.actionType, value.actionConfig, value.encryptedSecret])).rows[0];
        await deps.audit(request, "rule.update", "event_rule", old.id, { triggerType: value.triggerType, actionType: value.actionType });
        response.json({ data: publicRule(row) });
    }));
    router.delete("/rules/:id", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const old = await get(request);
        await deps.db.query("DELETE FROM campaigns.event_rules WHERE id=$1", [old.id]);
        await deps.audit(request, "rule.delete", "event_rule", old.id);
        response.json({ data: { ok: true } });
    }));
    router.post("/rules/deliveries/:id/retry", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const id = String(request.params.id ?? "");
        if (!UUID.test(id))
            throw fail(400, "Invalid rule delivery ID");
        const allowed = deps.restrictedLists(request);
        const current = (await deps.db.query(`SELECT o.*,r.name rule_name FROM campaigns.rule_outbox o
       JOIN campaigns.event_rules r ON r.id=o.rule_id WHERE o.id=$2 AND ${deliveryScope}`, [allowed, id])).rows[0];
        if (!current)
            throw fail(404, "Rule delivery not found");
        if (current.state === "delivered")
            throw fail(409, "Delivered rule actions cannot be retried");
        if (current.state !== "failed") {
            response.json({ data: { ...publicDelivery(current), retried: false } });
            return;
        }
        const retried = (await deps.db.query(`UPDATE campaigns.rule_outbox SET state='pending',attempt_count=0,available_at=now(),
       lease_until=NULL,delivered_at=NULL,last_error_code=NULL
       WHERE id=$1 AND state='failed' RETURNING *`, [id])).rows[0];
        const row = retried ?? (await deps.db.query("SELECT o.*,r.name rule_name FROM campaigns.rule_outbox o JOIN campaigns.event_rules r ON r.id=o.rule_id WHERE o.id=$1", [id])).rows[0];
        await deps.audit(request, "rule.delivery.retry", "rule_delivery", id, { ruleId: current.rule_id, retried: !!retried });
        response.json({ data: { ...publicDelivery({ ...row, rule_name: row?.rule_name ?? current.rule_name }), retried: !!retried } });
    }));
    return router;
}
function minimalPayload(event) {
    return {
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
        ...(event.campaignId ? { campaignId: event.campaignId } : {}),
        ...(event.campaignName ? { campaignName: event.campaignName.slice(0, 200) } : {}),
        ...(event.automationId ? { automationId: event.automationId } : {}),
        ...(event.subscriberId ? { subscriberId: event.subscriberId } : {}),
        ...(event.listId ? { listId: event.listId } : {}),
        ...(event.listIds?.length ? { listIds: event.listIds } : {}),
    };
}
/** Call with the transaction client that durably records the source event. */
export async function recordRuleEvent(db, event) {
    if (!event.eventId || event.eventId.length > 200 || !EVENT_TYPES.includes(event.type))
        throw new Error("Invalid rule event");
    for (const id of [event.campaignId, event.automationId, event.subscriberId, event.listId, ...(event.listIds ?? [])]) {
        if (id !== undefined && !UUID.test(id))
            throw new Error("Invalid rule event entity ID");
    }
    if (event.listIds && (event.listIds.length > 100 || new Set(event.listIds).size !== event.listIds.length))
        throw new Error("Invalid rule event list IDs");
    if (event.type === "list.joined" && (!event.subscriberId || !event.listId))
        throw new Error("list.joined requires subscriberId and listId");
    const listIds = event.listIds ?? (event.listId ? [event.listId] : []);
    const result = await db.query(`INSERT INTO campaigns.rule_outbox(id,rule_id,source_event_id,event_type,payload,action_type,action_config,encrypted_secret)
     SELECT gen_random_uuid(),r.id,$1,$2,$3,r.action_type,r.action_config,r.encrypted_secret
     FROM campaigns.event_rules r
     WHERE r.enabled AND r.trigger_type=$2 AND (r.trigger_list_id IS NULL OR r.trigger_list_id=ANY($4::uuid[]))
     ON CONFLICT(rule_id,event_type,source_event_id) DO NOTHING RETURNING id`, [event.eventId, event.type, minimalPayload(event), listIds]);
    return result.rowCount ?? 0;
}
function privateIp(ip) {
    if (ip.includes(":")) {
        const value = ip.toLowerCase();
        return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
            /^fe[89ab]/.test(value) || value.startsWith("::ffff:");
    }
    const parts = ip.split(".").map(Number);
    return parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255) ||
        parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
        (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127) ||
        (parts[0] ?? 0) >= 224;
}
async function defaultResolve(host) {
    const [v4, v6] = await Promise.all([resolve4(host).catch(() => []), resolve6(host).catch(() => [])]);
    return [...v4, ...v6];
}
const defaultTransport = (urlString, options) => new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = httpsRequest({
        protocol: "https:", hostname: options.address, port: 443, path: `${url.pathname}${url.search}`,
        method: "POST", servername: options.servername, rejectUnauthorized: true,
        headers: { ...options.headers, host: options.servername, "content-length": String(Buffer.byteLength(options.body)) },
    }, response => {
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
            response.destroy();
            reject(Object.assign(new Error("Webhook response too large"), { code: "WEBHOOK_RESPONSE_LIMIT" }));
            return;
        }
        let bytes = 0;
        response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > options.maxResponseBytes)
                response.destroy(Object.assign(new Error("Webhook response too large"), { code: "WEBHOOK_RESPONSE_LIMIT" }));
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0 }));
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(Object.assign(new Error("Webhook timed out"), { code: "WEBHOOK_TIMEOUT" })));
    request.on("error", reject);
    request.end(options.body);
});
export async function deliverSignedWebhook(options) {
    const url = new URL(webhookUrl(options.url));
    const body = JSON.stringify(options.payload);
    if (Buffer.byteLength(body) > 32_768)
        throw Object.assign(new Error("Webhook payload too large"), { code: "WEBHOOK_PAYLOAD_LIMIT" });
    const addresses = await (options.resolver ?? defaultResolve)(url.hostname);
    if (!addresses.length)
        throw Object.assign(new Error("Webhook host did not resolve"), { code: "WEBHOOK_DNS_FAILED" });
    if (addresses.some(privateIp))
        throw Object.assign(new Error("Webhook host resolved to an unsafe address"), { code: "WEBHOOK_SSRF_BLOCKED" });
    const signature = createHmac("sha256", options.secret).update(body).digest("hex");
    const result = await (options.transport ?? defaultTransport)(url.href, {
        address: addresses[0], servername: url.hostname, body, timeoutMs: 5_000, maxResponseBytes: 65_536,
        headers: {
            "content-type": "application/json", accept: "application/json",
            "x-sendrepute-delivery": options.deliveryId, "x-sendrepute-signature": `sha256=${signature}`,
        },
    });
    if (result.status >= 300 && result.status < 400)
        throw Object.assign(new Error("Webhook redirects are not allowed"), { code: "WEBHOOK_REDIRECT" });
    if (result.status < 200 || result.status >= 300)
        throw Object.assign(new Error("Webhook rejected delivery"), { code: `WEBHOOK_HTTP_${result.status}` });
}
export async function runRulesWebhookWorker(options) {
    const batch = Math.max(1, Math.min(50, options.batchSize ?? 10));
    const claimed = await options.db.query(`UPDATE campaigns.rule_outbox o SET state='sending',lease_until=now()+interval '1 minute',attempt_count=attempt_count+1
     WHERE o.id IN (SELECT id FROM campaigns.rule_outbox WHERE available_at<=now()
       AND (state='pending' OR state='sending' AND lease_until<now())
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1)
     RETURNING id,rule_id,event_type,payload,action_type,action_config,encrypted_secret,attempt_count`, [batch]);
    let delivered = 0, retried = 0, failed = 0;
    for (const item of claimed.rows) {
        try {
            if (item.action_type === "webhook") {
                if (!item.encrypted_secret)
                    throw Object.assign(new Error("Missing webhook secret"), { code: "WEBHOOK_SECRET_MISSING" });
                await deliverSignedWebhook({
                    url: String(item.action_config.url), secret: options.decrypt(options.key, item.encrypted_secret),
                    payload: item.payload, deliveryId: item.id, resolver: options.resolver, transport: options.transport,
                });
            }
            else if (item.action_type === "unsubscribe") {
                const target = String(item.action_config.listId);
                if (!UUID.test(target) || !await options.authorizeListAction(item.rule_id, target)) {
                    throw Object.assign(new Error("List action is not authorized"), { code: "LIST_SCOPE_DENIED" });
                }
                const subscriberId = String(item.payload.subscriberId ?? "");
                if (!UUID.test(subscriberId))
                    throw Object.assign(new Error("Event has no subscriber"), { code: "SUBSCRIBER_REQUIRED" });
                await options.db.query(`UPDATE campaigns.entities SET body=jsonb_set(
             jsonb_set(body,'{listIds}',coalesce((SELECT jsonb_agg(item.value) FROM jsonb_array_elements_text(body->'listIds') AS item(value) WHERE item.value<>$2),'[]'::jsonb)),
             '{status}',CASE WHEN (SELECT count(*) FROM jsonb_array_elements_text(body->'listIds') AS item(value) WHERE item.value<>$2)=0 THEN '"unsubscribed"'::jsonb ELSE body->'status' END
           ),updated_at=now() WHERE kind='subscribers' AND id=campaigns.reconciled_subscriber_id($1::uuid)`, [subscriberId, target]);
            }
            else if (item.action_type === "email_notification") {
                await options.enqueueEmail({
                    idempotencyKey: `rule:${item.id}`, to: String(item.action_config.to),
                    subject: String(item.action_config.subject),
                    text: `Campaigns rule event ${item.event_type} occurred. Event ID: ${String(item.payload.eventId)}`,
                });
            }
            else
                throw Object.assign(new Error("Unsupported rule action"), { code: "RULE_ACTION_INVALID" });
            await options.db.query("UPDATE campaigns.rule_outbox SET state='delivered',delivered_at=now(),lease_until=NULL,last_error_code=NULL WHERE id=$1 AND state='sending'", [item.id]);
            delivered++;
        }
        catch (error) {
            const terminal = item.attempt_count >= 5;
            const delay = Math.min(3600, 30 * (2 ** (item.attempt_count - 1)));
            await options.db.query(`UPDATE campaigns.rule_outbox SET state=$2,available_at=now()+($3||' seconds')::interval,
         lease_until=NULL,last_error_code=$4 WHERE id=$1 AND state='sending'`, [item.id, terminal ? "failed" : "pending", String(delay), String(error.code ?? "RULE_ACTION_ERROR").slice(0, 100)]);
            if (terminal)
                failed++;
            else
                retried++;
        }
    }
    return { claimed: claimed.rowCount ?? 0, delivered, retried, failed };
}
//# sourceMappingURL=rules-webhooks.js.map