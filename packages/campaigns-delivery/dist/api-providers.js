import { boundedFetch, httpFailure, safeProviderError } from "./http.js";
import { DeliveryError } from "./types.js";
import { sendSmtp, verifySmtp } from "./smtp.js";
const basic = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const address = (a) => ({ Email: a.email, ...(a.name ? { Name: a.name } : {}) });
export async function sendMailjet(config, message, options) {
    if (config.transport === "smtp") {
        const port = config.smtpPort ?? 587;
        return sendSmtp({ type: "smtp", host: "in-v3.mailjet.com", port, secure: port === 465, requireTls: port === 587, username: config.apiKey, password: config.secretKey }, message, options);
    }
    // The API renders final Campaigns content. Provider template controls must
    // not silently reinterpret locally rendered HTML/text or merge variables.
    if (Object.keys(message.headers ?? {}).some(name => /^x-mj-(?:template(?:id|language)|vars)$/i.test(name))) {
        throw new DeliveryError("Mailjet API template headers are not supported", "INVALID_MESSAGE", "not-sent");
    }
    const body = JSON.stringify({ Messages: [{
                From: address(message.from), To: [address(message.to)], Subject: message.subject,
                ...(message.html === undefined ? {} : { HTMLPart: message.html }),
                ...(message.text === undefined ? {} : { TextPart: message.text }),
                ...(message.headers ? { Headers: message.headers } : {}),
                CustomID: message.id.slice(0, 255),
            }] });
    const response = await boundedFetch("https://api.mailjet.com/v3.1/send", { method: "POST", headers: { authorization: basic(config.apiKey, config.secretKey), "content-type": "application/json" }, body }, options, "send");
    if (!response.ok) {
        const failure = httpFailure(response.status);
        throw new DeliveryError(safeProviderError(response.status, response.json), "MAILJET_REJECTED", failure.state, response.status, failure.retryable);
    }
    const item = response.json?.Messages?.[0];
    if (item?.Status !== "success")
        throw new DeliveryError("Mailjet response did not confirm acceptance", "MAILJET_INVALID_RESPONSE", "unknown", response.status);
    const id = item.To?.[0]?.MessageID;
    return { ...(typeof id === "number" || typeof id === "string" ? { providerMessageId: String(id) } : {}), status: "accepted" };
}
export async function verifyMailjet(config, options) {
    if (config.transport === "smtp") {
        try {
            const port = config.smtpPort ?? 587;
            await verifySmtp({ type: "smtp", host: "in-v3.mailjet.com", port, secure: port === 465, requireTls: port === 587, username: config.apiKey, password: config.secretKey }, options);
            return;
        }
        catch (error) {
            if (error instanceof DeliveryError)
                throw new DeliveryError(error.message.replace(/^SMTP/, "Mailjet SMTP"), `MAILJET_${error.code}`, "not-sent", error.statusCode, error.retryable);
            throw error;
        }
    }
    const response = await boundedFetch("https://api.mailjet.com/v3/REST/myprofile", { method: "GET", headers: { authorization: basic(config.apiKey, config.secretKey), accept: "application/json" } }, options, "verify");
    if (!response.ok)
        throw new DeliveryError(safeProviderError(response.status, response.json), "MAILJET_VERIFY_FAILED", "not-sent", response.status);
}
export async function sendSmtpCom(config, message, options) {
    const parts = [
        ...(message.text === undefined ? [] : [{ type: "text/plain", charset: "UTF-8", content: message.text }]),
        ...(message.html === undefined ? [] : [{ type: "text/html", charset: "UTF-8", content: message.html }]),
    ];
    const body = JSON.stringify({
        channel: config.channel,
        recipients: { to: [{ address: message.to.email, ...(message.to.name ? { name: message.to.name } : {}) }] },
        originator: { from: { address: message.from.email, ...(message.from.name ? { name: message.from.name } : {}) } },
        subject: message.subject,
        body: { parts },
        custom_headers: { ...(message.headers ?? {}), "X-SendRepute-ID": message.id },
    });
    const response = await boundedFetch("https://api.smtp.com/v4/messages", { method: "POST", headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json", "content-type": "application/json" }, body }, options, "send");
    if (!response.ok) {
        const failure = httpFailure(response.status);
        throw new DeliveryError(safeProviderError(response.status, response.json), "SMTPCOM_REJECTED", failure.state, response.status, failure.retryable);
    }
    const parsed = response.json;
    if (parsed?.status !== "success" || typeof parsed.data?.msg_id !== "string")
        throw new DeliveryError("SMTP.com accepted the request but returned no message id", "SMTPCOM_INVALID_RESPONSE", "unknown", response.status);
    return { providerMessageId: parsed.data.msg_id, status: "accepted" };
}
export async function verifySmtpCom(config, options) {
    const response = await boundedFetch("https://api.smtp.com/v4/account/", { method: "GET", headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json" } }, options, "verify");
    if (!response.ok)
        throw new DeliveryError(safeProviderError(response.status, response.json), "SMTPCOM_VERIFY_FAILED", "not-sent", response.status);
}
//# sourceMappingURL=api-providers.js.map