import { randomUUID } from "node:crypto";
import { Router } from "express";
const BOT_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;
const CHAT_ID = /^-?\d{5,20}$/;
const ALL_TYPES = ["started", "completed", "failed", "opened", "clicked"];
const DEFAULT_TYPES = ["started", "completed", "failed"];
export async function sendTelegramMessage(botToken, chatId, text) {
    if (!BOT_TOKEN.test(botToken) || !CHAT_ID.test(chatId))
        throw new Error("Invalid Telegram credentials");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    timer.unref();
    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
        });
        const body = await response.arrayBuffer();
        if (body.byteLength > 65_536)
            throw new Error("Telegram response exceeded limit");
        let result;
        try {
            result = JSON.parse(Buffer.from(body).toString("utf8"));
        }
        catch {
            result = null;
        }
        if (!response.ok || !result || result.ok !== true) {
            throw Object.assign(new Error("Telegram rejected the message"), { code: `TELEGRAM_${response.status}` });
        }
    }
    catch (error) {
        if (error.name === "AbortError") {
            throw Object.assign(new Error("Telegram request timed out"), { code: "TELEGRAM_TIMEOUT" });
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
function validateTypes(value) {
    if (!Array.isArray(value) || value.some(type => !ALL_TYPES.includes(type))) {
        throw Object.assign(new Error("eventTypes contains an unsupported notification type"), { status: 400 });
    }
    return [...new Set(value)];
}
function maskChatId(chatId) {
    return chatId.length <= 6 ? "******" : `${chatId.slice(0, 3)}…${chatId.slice(-3)}`;
}
export function createTelegramNotificationsRouter(deps) {
    const router = Router();
    router.get("/notifications/telegram", deps.need("settings:manage"), deps.wrap(async (_request, response) => {
        const result = await deps.db.query("SELECT enabled,encrypted_bot_token,encrypted_chat_id,event_types FROM campaigns.telegram_notification_settings WHERE singleton=true");
        const row = result.rows[0];
        const chatId = row?.encrypted_chat_id ? deps.decrypt(deps.key, row.encrypted_chat_id) : null;
        response.json({ data: {
                enabled: row?.enabled ?? false,
                configured: !!(row?.encrypted_bot_token && row.encrypted_chat_id),
                chatIdMasked: chatId ? maskChatId(chatId) : null,
                eventTypes: row?.event_types ?? DEFAULT_TYPES,
            } });
    }));
    router.put("/notifications/telegram", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const body = deps.json(request.body);
        deps.fields(body, ["enabled", "botToken", "chatId", "eventTypes"], ["enabled", "eventTypes"]);
        if (typeof body.enabled !== "boolean")
            throw deps.http(400, "enabled must be a boolean");
        const eventTypes = validateTypes(body.eventTypes);
        const current = await deps.db.query("SELECT encrypted_bot_token,encrypted_chat_id FROM campaigns.telegram_notification_settings WHERE singleton=true");
        const token = body.botToken === undefined ? null : String(body.botToken);
        const chatId = body.chatId === undefined ? null : String(body.chatId);
        if (token !== null && !BOT_TOKEN.test(token))
            throw deps.http(400, "Invalid Telegram bot token format");
        if (chatId !== null && !CHAT_ID.test(chatId))
            throw deps.http(400, "Invalid Telegram chat ID format");
        const encryptedToken = token === null ? current.rows[0]?.encrypted_bot_token ?? null : deps.encrypt(deps.key, token);
        const encryptedChat = chatId === null ? current.rows[0]?.encrypted_chat_id ?? null : deps.encrypt(deps.key, chatId);
        if (body.enabled === true && (!encryptedToken || !encryptedChat))
            throw deps.http(400, "Bot token and chat ID are required before enabling Telegram");
        await deps.db.query(`INSERT INTO campaigns.telegram_notification_settings(singleton,enabled,encrypted_bot_token,encrypted_chat_id,event_types,updated_at)
       VALUES(true,$1,$2,$3,$4,now())
       ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,encrypted_bot_token=excluded.encrypted_bot_token,
         encrypted_chat_id=excluded.encrypted_chat_id,event_types=excluded.event_types,updated_at=now()`, [body.enabled === true, encryptedToken, encryptedChat, eventTypes]);
        await deps.audit(request, "telegram.settings.update", "notification_settings", null, {
            enabled: body.enabled === true, configured: !!(encryptedToken && encryptedChat), eventTypes,
        });
        response.json({ data: {
                enabled: body.enabled === true, configured: !!(encryptedToken && encryptedChat),
                chatIdMasked: encryptedChat ? maskChatId(deps.decrypt(deps.key, encryptedChat)) : null, eventTypes,
            } });
    }));
    router.post("/notifications/telegram/test", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const body = deps.json(request.body);
        deps.fields(body, ["confirmation"], ["confirmation"]);
        if (body.confirmation !== "SEND_TELEGRAM_TEST")
            throw deps.http(400, "Invalid confirmation");
        const result = await deps.db.query("SELECT encrypted_bot_token,encrypted_chat_id FROM campaigns.telegram_notification_settings WHERE singleton=true");
        const row = result.rows[0];
        if (!row?.encrypted_bot_token || !row.encrypted_chat_id)
            throw deps.http(409, "Telegram is not configured");
        try {
            await deps.sender(deps.decrypt(deps.key, row.encrypted_bot_token), deps.decrypt(deps.key, row.encrypted_chat_id), "SendRepute Campaigns test notification. This confirms Telegram API delivery only.");
        }
        catch {
            throw deps.http(502, "Telegram test delivery failed");
        }
        await deps.audit(request, "telegram.test", "notification_settings", null);
        response.json({ data: { delivered: true, message: "Telegram accepted the test message." } });
    }));
    return router;
}
export async function enqueueCampaignNotification(db, event) {
    const settings = await db.query("SELECT enabled,event_types FROM campaigns.telegram_notification_settings WHERE singleton=true");
    if (!settings.rows[0]?.enabled || !settings.rows[0].event_types.includes(event.type))
        return false;
    if (event.type === "opened" || event.type === "clicked") {
        const budget = await db.query(`SELECT count(*)::text count FROM campaigns.notification_outbox
       WHERE campaign_id=$1 AND event_type IN ('opened','clicked') AND created_at>=now()-interval '1 hour'`, [event.campaignId]);
        if (Number(budget.rows[0]?.count ?? 0) >= 20) {
            const bucket = new Date();
            bucket.setUTCMinutes(0, 0, 0);
            const summary = await db.query(`INSERT INTO campaigns.notification_outbox(id,channel,dedupe_key,campaign_id,event_type,payload)
         VALUES($1,'telegram',$2,$3,'engagement_summary',$4)
         ON CONFLICT(channel,dedupe_key) DO NOTHING RETURNING id`, [randomUUID(), `engagement-summary:${event.campaignId}:${bucket.toISOString()}`, event.campaignId,
                { text: `Campaign "${event.campaignName}" has additional authenticated engagement events. Individual alerts are limited to 20 per hour.` }]);
            return !!summary.rowCount;
        }
    }
    const inserted = await db.query(`INSERT INTO campaigns.notification_outbox(id,channel,dedupe_key,campaign_id,event_type,payload)
     VALUES($1,'telegram',$2,$3,$4,$5) ON CONFLICT(channel,dedupe_key) DO NOTHING RETURNING id`, [randomUUID(), event.dedupeKey, event.campaignId, event.type, { text: event.text }]);
    return !!inserted.rowCount;
}
export async function runTelegramNotificationWorker(options) {
    const sender = options.sender ?? sendTelegramMessage;
    const batch = Math.max(1, Math.min(50, options.batchSize ?? 10));
    const settings = await options.db.query("SELECT enabled,encrypted_bot_token,encrypted_chat_id FROM campaigns.telegram_notification_settings WHERE singleton=true");
    const configured = settings.rows[0];
    if (!configured?.enabled || !configured.encrypted_bot_token || !configured.encrypted_chat_id) {
        return { claimed: 0, delivered: 0, retried: 0, failed: 0 };
    }
    const claimed = await options.db.query(`UPDATE campaigns.notification_outbox o SET state='sending',lease_until=now()+interval '1 minute',attempt_count=attempt_count+1
     WHERE o.id IN (
       SELECT id FROM campaigns.notification_outbox
       WHERE channel='telegram' AND available_at<=now()
         AND (state='pending' OR state='sending' AND lease_until<now())
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
     ) RETURNING id,payload,attempt_count`, [batch]);
    let delivered = 0, retried = 0, failed = 0;
    const token = options.decrypt(options.key, configured.encrypted_bot_token);
    const chatId = options.decrypt(options.key, configured.encrypted_chat_id);
    for (const item of claimed.rows) {
        try {
            await sender(token, chatId, String(item.payload.text ?? ""));
            await options.db.query("UPDATE campaigns.notification_outbox SET state='delivered',delivered_at=now(),lease_until=NULL,last_error_code=NULL WHERE id=$1 AND state='sending'", [item.id]);
            delivered++;
        }
        catch (error) {
            const terminal = item.attempt_count >= 5;
            const delay = Math.min(3600, 30 * (2 ** (item.attempt_count - 1)));
            await options.db.query(`UPDATE campaigns.notification_outbox SET state=$2,available_at=now()+($3||' seconds')::interval,
           lease_until=NULL,last_error_code=$4 WHERE id=$1 AND state='sending'`, [item.id, terminal ? "failed" : "pending", String(delay), String(error.code ?? "TELEGRAM_ERROR").slice(0, 100)]);
            if (terminal)
                failed++;
            else
                retried++;
        }
    }
    return { claimed: claimed.rowCount ?? 0, delivered, retried, failed };
}
//# sourceMappingURL=telegram-notifications.js.map