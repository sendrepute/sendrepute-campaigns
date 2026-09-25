import { createHash } from "node:crypto";
import { boundedFetch } from "./http.js";
export class ProviderAnalyticsError extends Error {
    kind;
    statusCode;
    constructor(message, kind, statusCode) {
        super(message);
        this.kind = kind;
        this.statusCode = statusCode;
        this.name = "ProviderAnalyticsError";
    }
}
const allFalse = Object.freeze({
    delivered: false, opened: false, clicked: false, hard_bounce: false,
    soft_bounce: false, complained: false, unsubscribed: false,
});
const common = Object.freeze({
    delivered: true, opened: true, clicked: true, hard_bounce: true,
    soft_bounce: true, complained: true, unsubscribed: true,
});
export function providerAnalyticsCapability(type) {
    switch (type) {
        case "ses":
            return { availability: "webhook", metrics: common, reason: "SES publishes per-message events through configuration-set event destinations; it has no per-message analytics polling endpoint." };
        case "mailjet":
        case "mailgun":
        case "sendgrid":
        case "postmark":
        case "brevo":
            return { availability: "poll_and_webhook", metrics: common };
        case "resend":
            return { availability: "poll_and_webhook", metrics: common, reason: "Polling is bounded to known provider message IDs; webhooks provide the event stream." };
        case "smtpcom":
            return { availability: "webhook", metrics: common, reason: "SMTP.com documents callback notifications; this integration does not claim an undocumented history endpoint." };
        case "smtp":
            return { availability: "webhook", metrics: allFalse, reason: "Generic SMTP has no analytics API. Only explicitly configured relay event hooks can supply events." };
    }
}
function stable(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(stable).join(",")}]`;
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}
function iso(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
        const date = new Date(milliseconds);
        return Number.isNaN(date.valueOf()) ? null : date.toISOString();
    }
    if (typeof value !== "string" || !value.trim())
        return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
function text(...values) {
    const value = values.find(item => (typeof item === "string" || typeof item === "number") && String(item).trim());
    return value === undefined ? undefined : String(value).trim();
}
function normalizedType(value, detail) {
    const type = String(value ?? "").toLowerCase().replace(/[\s.-]+/g, "_").replace(/^email_/, "");
    const reason = String(detail ?? "").toLowerCase();
    // "sent"/"processed" means accepted by several providers (not delivered).
    if (["delivered", "delivery"].includes(type))
        return "delivered";
    if (["open", "opened"].includes(type))
        return "opened";
    if (["click", "clicked", "linkclicked"].includes(type))
        return "clicked";
    if (["spam", "spamcomplaint", "complaint", "complained"].includes(type))
        return "complained";
    if (["unsubscribe", "unsubscribed", "subscriptionchanged"].includes(type))
        return "unsubscribed";
    if (["soft_bounce", "softbounce", "deferred", "deliverydelay", "bounceblock", "transient"].includes(type))
        return "soft_bounce";
    if (["hard_bounce", "hardbounce", "blocked"].includes(type))
        return "hard_bounce";
    if (type === "failed")
        return /temporary|soft|transient/.test(reason) ? "soft_bounce" : "hard_bounce";
    if (["bounce", "bounced"].includes(type))
        return /soft|temporary|transient|defer|mailbox full/.test(reason) ? "soft_bounce" : "hard_bounce";
    return null;
}
function event(provider, providerMessageId, kind, occurred, values = {}) {
    const id = text(providerMessageId);
    const type = normalizedType(kind, values.detail);
    const occurredAt = iso(occurred);
    if (!id || id.length > 998 || !type || !occurredAt)
        return null;
    const recipient = text(values.recipient)?.toLowerCase();
    const link = text(values.link);
    const identity = { provider, providerMessageId: id, type, occurredAt, ...(recipient ? { recipient } : {}), ...(link && type === "clicked" ? { link } : {}) };
    return {
        ...identity,
        canonicalFingerprint: createHash("sha256").update(stable(identity)).digest("hex"),
        ...(values.metadata ? { metadata: values.metadata } : {}),
    };
}
export function providerAnalyticsEventKey(value) {
    return `${value.provider}:${value.providerMessageId}:${value.type}:${value.occurredAt}:${value.canonicalFingerprint}`;
}
function objects(payload) {
    if (Array.isArray(payload))
        return payload.filter((item) => !!item && typeof item === "object" && !Array.isArray(item));
    if (payload && typeof payload === "object")
        return [payload];
    return [];
}
/** Normalizes already-authenticated webhook bodies. Signature/token validation remains provider-specific. */
export function normalizeProviderAnalyticsWebhook(type, payload) {
    let source = payload;
    if (type === "ses" && payload && typeof payload === "object") {
        const envelope = payload;
        if (typeof envelope.Message === "string") {
            try {
                source = JSON.parse(envelope.Message);
            }
            catch {
                return [];
            }
        }
    }
    const root = source && typeof source === "object" && !Array.isArray(source) ? source : undefined;
    const rows = type === "sendgrid" ? objects(source)
        : type === "mailjet" ? objects(source)
            : type === "ses" ? objects(root)
                : type === "brevo" ? objects(source)
                    : type === "resend" ? objects(root?.data ?? source)
                        : objects(source);
    return rows.map(row => {
        if (type === "ses") {
            const mail = (row.mail ?? {});
            const detail = (row.bounce ?? row.deliveryDelay ?? row.complaint ?? row.delivery ?? row.open ?? row.click ?? {});
            return event(type, mail.messageId, row.eventType ?? row.notificationType, detail.timestamp ?? mail.timestamp, {
                recipient: (Array.isArray(detail.recipients) ? detail.recipients[0] : undefined) ?? (Array.isArray(mail.destination) ? mail.destination[0] : undefined),
                link: detail.link,
                detail: (detail.bounceType ?? detail.delayType),
            });
        }
        if (type === "mailjet") {
            const kind = String(row.event ?? row.EventType ?? "").toLowerCase() === "sent" ? "delivered" : row.event ?? row.EventType;
            return event(type, row.MessageID ?? row.message_id, kind, row.time ?? row.EventAt, { recipient: row.email ?? row.ContactAlt, link: row.url, detail: row.error_related_to });
        }
        if (type === "sendgrid")
            return event(type, row.sg_message_id ?? row.msg_id, row.event, row.timestamp, { recipient: row.email, link: row.url, detail: row.type ?? row.reason });
        if (type === "postmark")
            return event(type, row.MessageID, row.RecordType ?? row.Type ?? row.Status, row.DeliveredAt ?? row.ReceivedAt ?? row.BouncedAt, { recipient: row.Recipient ?? row.Email, link: row.OriginalLink ?? row.Details?.Link, detail: row.Details?.Type ?? row.Description });
        if (type === "brevo")
            return event(type, row["message-id"] ?? row.messageId, row.event, row.date ?? row.ts_event, { recipient: row.email, link: row.link, detail: row.reason });
        if (type === "resend")
            return event(type, row.email_id ?? row.id, row.type ?? row.last_event, row.created_at ?? row.updated_at, { recipient: row.to, link: row.click?.link });
        if (type === "mailgun") {
            const headers = row.message?.headers;
            const status = row["delivery-status"];
            return event(type, headers?.["message-id"] ?? row.id, row.event, row.timestamp, { recipient: row.recipient, detail: status?.severity ?? status?.description });
        }
        return event(type, row.message_id ?? row.msg_id, row.event ?? row.type, row.timestamp ?? row.time, { recipient: row.email ?? row.recipient, link: row.url, detail: row.reason ?? row.description });
    }).filter((item) => !!item);
}
function cursor(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
        return parsed;
    }
    catch {
        throw new ProviderAnalyticsError("Invalid provider analytics cursor", "provider");
    }
}
function next(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
async function get(url, headers, options) {
    const result = await boundedFetch(url, { method: "GET", headers: { accept: "application/json", ...headers } }, options, "verify");
    if (!result.ok) {
        const kind = result.status === 401 ? "authentication" : result.status === 403 ? "permission" : result.status === 429 ? "rate_limited" : "provider";
        throw new ProviderAnalyticsError(kind === "permission" ? "Provider API key lacks analytics permission" : kind === "authentication" ? "Provider analytics authentication failed" : `Provider analytics request failed (HTTP ${result.status})`, kind, result.status);
    }
    return result.json;
}
function dateOnly(value) { return value.toISOString().slice(0, 10); }
export async function syncProviderAnalytics(config, request = {}, options = {}) {
    const limit = Math.max(1, Math.min(100, request.limit ?? 50));
    const state = cursor(request.cursor);
    const now = request.now ?? new Date();
    let payload;
    let nextState = {};
    let rows = [];
    if (config.type === "ses" || config.type === "smtp" || config.type === "smtpcom") {
        throw new ProviderAnalyticsError(providerAnalyticsCapability(config.type).reason ?? "Provider polling is unavailable", "unavailable");
    }
    if (config.type === "mailjet") {
        const offset = Number(state.offset ?? 0);
        payload = await get(`https://api.mailjet.com/v3/REST/messageevent?Limit=${limit}&Offset=${offset}&Sort=EventAt+ASC`, { authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.secretKey}`).toString("base64")}` }, options);
        const data = payload?.Data;
        rows = normalizeProviderAnalyticsWebhook("mailjet", data);
        nextState = { offset: offset + (Array.isArray(data) ? data.length : 0) };
    }
    else if (config.type === "brevo") {
        const offset = Number(state.offset ?? 0);
        const start = typeof state.start === "string" ? state.start : dateOnly(new Date(now.valueOf() - 7 * 86_400_000));
        payload = await get(`https://api.brevo.com/v3/smtp/statistics/events?limit=${limit}&offset=${offset}&sort=asc&startDate=${encodeURIComponent(start)}&endDate=${dateOnly(now)}`, { "api-key": config.apiKey }, options);
        const events = payload?.events;
        rows = normalizeProviderAnalyticsWebhook("brevo", events);
        nextState = { start, offset: offset + (Array.isArray(events) ? events.length : 0) };
    }
    else if (config.type === "postmark") {
        const offset = Number(state.offset ?? 0);
        const from = typeof state.from === "string" ? state.from : new Date(now.valueOf() - 7 * 86_400_000).toISOString();
        payload = await get(`https://api.postmarkapp.com/messages/outbound?count=${limit}&offset=${offset}&fromdate=${encodeURIComponent(from)}&todate=${encodeURIComponent(now.toISOString())}`, { "x-postmark-server-token": config.serverToken }, options);
        const messages = payload?.Messages;
        const summaries = objects(messages);
        const details = await Promise.all(summaries.map(async (summary) => {
            const id = text(summary.MessageID);
            if (!id)
                return undefined;
            return get(`https://api.postmarkapp.com/messages/outbound/${encodeURIComponent(id)}/details`, { "x-postmark-server-token": config.serverToken }, options);
        }));
        rows = details.flatMap(detail => {
            if (!detail || typeof detail !== "object")
                return [];
            const body = detail;
            return objects(body.MessageEvents).flatMap(item => normalizeProviderAnalyticsWebhook("postmark", { ...item, MessageID: body.MessageID }));
        });
        nextState = { from, offset: offset + (Array.isArray(messages) ? messages.length : 0) };
    }
    else if (config.type === "sendgrid") {
        const pageToken = typeof state.pageToken === "string" ? state.pageToken : undefined;
        const from = typeof state.from === "string" ? state.from : new Date(now.valueOf() - 7 * 86_400_000).toISOString();
        const to = typeof state.to === "string" ? state.to : now.toISOString();
        const query = `last_event_time BETWEEN TIMESTAMP "${from}" AND TIMESTAMP "${to}"`;
        const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "";
        payload = await get(`https://api.sendgrid.com/v3/messages?limit=${limit}&query=${encodeURIComponent(query)}${suffix}`, { authorization: `Bearer ${config.apiKey}` }, options);
        const body = payload;
        rows = objects(body.messages).flatMap(message => {
            const at = message.last_event_time;
            const id = message.msg_id;
            const recipient = message.to_email;
            const events = [];
            const status = event("sendgrid", id, message.status, at, { recipient });
            if (status)
                events.push(status);
            if (Number(message.opens_count) > 0) {
                const item = event("sendgrid", id, "opened", at, { recipient });
                if (item)
                    events.push(item);
            }
            if (Number(message.clicks_count) > 0) {
                const item = event("sendgrid", id, "clicked", at, { recipient });
                if (item)
                    events.push(item);
            }
            return events;
        });
        nextState = typeof body.next_page_token === "string" ? { from, to, pageToken: body.next_page_token } : {};
    }
    else if (config.type === "mailgun") {
        const host = config.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
        const begin = typeof state.begin === "string" ? state.begin : new Date(now.valueOf() - 7 * 86_400_000).toUTCString();
        const base = `https://${host}/v3/${encodeURIComponent(config.domain)}/events`;
        const pageQuery = typeof state.pageQuery === "string" && state.pageQuery.length <= 4096 ? state.pageQuery : undefined;
        payload = await get(pageQuery ? `${base}?${pageQuery}` : `${base}?limit=${limit}&ascending=yes&begin=${encodeURIComponent(begin)}`, { authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}` }, options);
        const body = payload;
        rows = normalizeProviderAnalyticsWebhook("mailgun", body.items);
        const paging = body.paging;
        const nextUrl = typeof paging?.next === "string" ? new URL(paging.next) : undefined;
        if (nextUrl && nextUrl.protocol === "https:" && nextUrl.hostname === host && nextUrl.pathname === `/v3/${encodeURIComponent(config.domain)}/events`)
            nextState = { begin, pageQuery: nextUrl.searchParams.toString() };
        else
            nextState = { begin };
    }
    else {
        const ids = [...new Set(request.providerMessageIds ?? [])].filter(id => id && id.length <= 998).slice(0, limit);
        const offset = Number(state.offset ?? 0);
        const batch = ids.slice(offset, offset + limit);
        const responses = await Promise.all(batch.map(id => get(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { authorization: `Bearer ${config.apiKey}` }, options)));
        rows = responses.flatMap(value => normalizeProviderAnalyticsWebhook("resend", value));
        nextState = { offset: offset + batch.length };
    }
    const unique = [...new Map(rows.map(item => [providerAnalyticsEventKey(item), item])).values()];
    const count = config.type === "resend" ? Math.min(limit, (request.providerMessageIds ?? []).length - Number(state.offset ?? 0))
        : Array.isArray(payload?.Data) ? payload.Data.length
            : Array.isArray(payload?.events) ? payload.events.length
                : Array.isArray(payload?.Messages) ? payload.Messages.length
                    : Array.isArray(payload?.messages) ? payload.messages.length
                        : Array.isArray(payload?.items) ? payload.items.length : 0;
    return { events: unique, nextCursor: next(nextState), hasMore: count >= limit };
}
//# sourceMappingURL=provider-analytics.js.map