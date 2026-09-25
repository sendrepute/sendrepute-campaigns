import { createHash, createHmac } from "node:crypto";
import { boundedFetch, httpFailure, safeProviderError } from "./http.js";
import { DeliveryError } from "./types.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
function sign(config, method, path, body, now = new Date()) {
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const host = `email.${config.region}.amazonaws.com`;
    const headers = {
        "content-type": "application/json",
        host,
        "x-amz-date": amzDate,
    };
    if (config.sessionToken)
        headers["x-amz-security-token"] = config.sessionToken;
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
    const signedHeaders = names.join(";");
    const canonical = [method, path, "", canonicalHeaders, signedHeaders, hash(body)].join("\n");
    const scope = `${date}/${config.region}/ses/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), "ses"), "aws4_request");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    return headers;
}
export async function sendSes(config, message, options) {
    const path = "/v2/email/outbound-emails";
    const body = JSON.stringify({
        FromEmailAddress: message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email,
        Destination: { ToAddresses: [message.to.name ? `${message.to.name} <${message.to.email}>` : message.to.email] },
        Content: { Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: {
                    ...(message.html === undefined ? {} : { Html: { Data: message.html, Charset: "UTF-8" } }),
                    ...(message.text === undefined ? {} : { Text: { Data: message.text, Charset: "UTF-8" } }),
                },
                ...(message.headers ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
            } },
        ...(config.configurationSetName ? { ConfigurationSetName: config.configurationSetName } : {}),
        EmailTags: [{ Name: "sendrepute-id", Value: message.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) }],
    });
    const response = await boundedFetch(`https://email.${config.region}.amazonaws.com${path}`, { method: "POST", headers: sign(config, "POST", path, body), body }, options, "send");
    if (!response.ok) {
        const failure = httpFailure(response.status);
        throw new DeliveryError(safeProviderError(response.status, response.json), "SES_REJECTED", failure.state, response.status, failure.retryable);
    }
    const id = response.json?.MessageId;
    if (typeof id !== "string")
        throw new DeliveryError("SES accepted the request but returned no message id", "SES_INVALID_RESPONSE", "unknown", response.status);
    return { providerMessageId: id, status: "accepted" };
}
export async function verifySes(config, options) {
    const path = "/v2/email/account";
    const response = await boundedFetch(`https://email.${config.region}.amazonaws.com${path}`, { method: "GET", headers: sign(config, "GET", path, "") }, options, "verify");
    if (!response.ok)
        throw new DeliveryError(safeProviderError(response.status, response.json), "SES_VERIFY_FAILED", "not-sent", response.status);
}
//# sourceMappingURL=ses.js.map