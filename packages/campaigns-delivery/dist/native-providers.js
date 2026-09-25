import { boundedFetch, httpFailure, safeProviderError } from "./http.js";
import { DeliveryError, } from "./types.js";
function bearer(value) {
    return { authorization: `Bearer ${value}`, accept: "application/json" };
}
function jsonHeaders(extra) {
    return { ...extra, "content-type": "application/json", accept: "application/json" };
}
function display(address) {
    return address.name ? `${address.name} <${address.email}>` : address.email;
}
function responseId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\r\n]/.test(value) ? value : undefined;
}
function rejected(provider, status, body) {
    const failure = httpFailure(status);
    throw new DeliveryError(safeProviderError(status, body), `${provider}_REJECTED`, failure.state, status, failure.retryable);
}
export async function sendNativeApi(config, message, options) {
    if (config.type === "sendgrid") {
        const content = [
            ...(message.text === undefined ? [] : [{ type: "text/plain", value: message.text }]),
            ...(message.html === undefined ? [] : [{ type: "text/html", value: message.html }]),
        ];
        const body = JSON.stringify({
            personalizations: [{ to: [message.to], custom_args: { sendrepute_id: message.id } }],
            from: message.from, subject: message.subject, content, ...(message.headers ? { headers: message.headers } : {}),
        });
        const response = await boundedFetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", headers: jsonHeaders(bearer(config.apiKey)), body }, options, "send");
        if (!response.ok)
            rejected("SENDGRID", response.status, response.json);
        const id = responseId(response.header("x-message-id"));
        return { ...(id ? { providerMessageId: id } : {}), status: "accepted" };
    }
    if (config.type === "mailgun") {
        const origin = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
        const body = new URLSearchParams({ from: display(message.from), to: display(message.to), subject: message.subject, "v:sendrepute-id": message.id });
        if (message.text !== undefined)
            body.set("text", message.text);
        if (message.html !== undefined)
            body.set("html", message.html);
        for (const [name, value] of Object.entries(message.headers ?? {}))
            body.set(`h:${name}`, value);
        const authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`;
        const response = await boundedFetch(`${origin}/v3/${encodeURIComponent(config.domain)}/messages`, { method: "POST", headers: { authorization, accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }, options, "send");
        if (!response.ok)
            rejected("MAILGUN", response.status, response.json);
        const id = responseId(response.json?.id);
        if (!id)
            throw new DeliveryError("Mailgun accepted the request but returned no valid message id", "MAILGUN_INVALID_RESPONSE", "unknown", response.status);
        return { providerMessageId: id, status: "accepted" };
    }
    if (config.type === "postmark") {
        const body = JSON.stringify({
            From: display(message.from), To: display(message.to), Subject: message.subject,
            ...(message.html === undefined ? {} : { HtmlBody: message.html }),
            ...(message.text === undefined ? {} : { TextBody: message.text }),
            ...(message.headers ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
            Metadata: { sendrepute_id: message.id },
        });
        const response = await boundedFetch("https://api.postmarkapp.com/email", { method: "POST", headers: jsonHeaders({ "x-postmark-server-token": config.serverToken }), body }, options, "send");
        if (!response.ok)
            rejected("POSTMARK", response.status, response.json);
        const parsed = response.json;
        if (typeof parsed?.ErrorCode === "number" && parsed.ErrorCode !== 0)
            throw new DeliveryError("Postmark rejected the message", "POSTMARK_REJECTED", "rejected", response.status);
        if (parsed?.ErrorCode !== 0)
            throw new DeliveryError("Postmark response did not confirm acceptance", "POSTMARK_INVALID_RESPONSE", "unknown", response.status);
        const id = responseId(parsed.MessageID);
        if (!id)
            throw new DeliveryError("Postmark accepted the request but returned no valid message id", "POSTMARK_INVALID_RESPONSE", "unknown", response.status);
        return { providerMessageId: id, status: "accepted" };
    }
    if (config.type === "resend") {
        const body = JSON.stringify({
            from: display(message.from), to: [display(message.to)], subject: message.subject,
            ...(message.html === undefined ? {} : { html: message.html }),
            ...(message.text === undefined ? {} : { text: message.text }),
            ...(message.headers ? { headers: message.headers } : {}),
        });
        const response = await boundedFetch("https://api.resend.com/emails", { method: "POST", headers: jsonHeaders({ ...bearer(config.apiKey), "idempotency-key": message.id.slice(0, 256) }), body }, options, "send");
        if (!response.ok)
            rejected("RESEND", response.status, response.json);
        const id = responseId(response.json?.id);
        if (!id)
            throw new DeliveryError("Resend accepted the request but returned no valid message id", "RESEND_INVALID_RESPONSE", "unknown", response.status);
        return { providerMessageId: id, status: "accepted" };
    }
    const body = JSON.stringify({
        sender: message.from, to: [message.to], subject: message.subject,
        ...(message.html === undefined ? {} : { htmlContent: message.html }),
        ...(message.text === undefined ? {} : { textContent: message.text }),
        ...(message.headers ? { headers: message.headers } : {}),
        tags: ["sendrepute"],
    });
    const response = await boundedFetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: jsonHeaders({ "api-key": config.apiKey }), body }, options, "send");
    if (!response.ok)
        rejected("BREVO", response.status, response.json);
    const id = responseId(response.json?.messageId);
    if (!id)
        throw new DeliveryError("Brevo accepted the request but returned no valid message id", "BREVO_INVALID_RESPONSE", "unknown", response.status);
    return { providerMessageId: id, status: "accepted" };
}
export async function verifyNativeApi(config, options) {
    let url;
    let headers;
    if (config.type === "sendgrid") {
        url = "https://api.sendgrid.com/v3/scopes";
        headers = bearer(config.apiKey);
    }
    else if (config.type === "mailgun") {
        const origin = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
        url = `${origin}/v4/domains/${encodeURIComponent(config.domain)}`;
        headers = { authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`, accept: "application/json" };
    }
    else if (config.type === "postmark") {
        url = "https://api.postmarkapp.com/server";
        headers = { "x-postmark-server-token": config.serverToken, accept: "application/json" };
    }
    else if (config.type === "resend") {
        url = "https://api.resend.com/domains";
        headers = bearer(config.apiKey);
    }
    else {
        url = "https://api.brevo.com/v3/account";
        headers = { "api-key": config.apiKey, accept: "application/json" };
    }
    const response = await boundedFetch(url, { method: "GET", headers }, options, "verify");
    if (response.ok)
        return "verified";
    if ((config.type === "sendgrid" || config.type === "resend") && response.status === 403)
        return "inconclusive";
    throw new DeliveryError(safeProviderError(response.status, response.json), `${config.type.toUpperCase()}_VERIFY_FAILED`, "not-sent", response.status);
}
//# sourceMappingURL=native-providers.js.map