import { createVerify, timingSafeEqual, X509Certificate } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { DeliveryError } from "./types.js";
import { publicAddress } from "./validate.js";
const MAX_WEBHOOK_BYTES = 1_048_576;
const MAX_CERT_BYTES = 65_536;
const CERT_CACHE_MS = 5 * 60_000;
const certCache = new Map();
function equalSecret(actual, expected) {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
export function parseTokenWebhook(provider, rawBody, actualToken, expectedToken) {
    if (!expectedToken || !equalSecret(actualToken, expectedToken))
        throw new DeliveryError(`Unauthenticated ${provider} webhook`, "WEBHOOK_UNAUTHENTICATED", "not-sent");
    const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
    if (Buffer.byteLength(text) > MAX_WEBHOOK_BYTES)
        throw new DeliveryError("Webhook body is too large", "WEBHOOK_TOO_LARGE", "not-sent");
    try {
        return JSON.parse(text);
    }
    catch {
        throw new DeliveryError("Invalid webhook JSON", "WEBHOOK_INVALID", "not-sent");
    }
}
function snsCertificateUrl(value, topicArn) {
    if (typeof value !== "string" || value.length > 2048)
        throw new DeliveryError("Invalid SNS certificate URL", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new DeliveryError("Invalid SNS certificate URL", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    }
    const host = url.hostname.match(/^sns\.([a-z0-9-]+)\.amazonaws\.com$/i);
    const topicRegion = typeof topicArn === "string" ? topicArn.split(":")[3] : undefined;
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
        !host || host[1] !== topicRegion ||
        !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname)) {
        throw new DeliveryError("Untrusted SNS certificate URL", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    }
    return url;
}
async function defaultResolve(host) {
    if (isIP(host))
        return [host];
    const [v4, v6] = await Promise.all([resolve4(host).catch(() => []), resolve6(host).catch(() => [])]);
    return [...v4, ...v6];
}
async function pinnedCertificateFetch(urlString, options) {
    const url = new URL(urlString);
    return new Promise((resolve, reject) => {
        const request = httpsRequest({
            protocol: "https:",
            hostname: options.address,
            port: 443,
            path: url.pathname,
            method: "GET",
            servername: options.servername,
            rejectUnauthorized: true,
            headers: { host: options.servername, accept: "application/x-pem-file" },
        }, response => {
            const declared = Number(response.headers["content-length"]);
            if (Number.isFinite(declared) && declared > options.maxBytes) {
                response.destroy();
                reject(new DeliveryError("SNS certificate is too large", "WEBHOOK_CERTIFICATE_INVALID", "not-sent"));
                return;
            }
            const chunks = [];
            let length = 0;
            response.on("data", (chunk) => {
                length += chunk.length;
                if (length > options.maxBytes) {
                    response.destroy(new DeliveryError("SNS certificate is too large", "WEBHOOK_CERTIFICATE_INVALID", "not-sent"));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
        });
        request.setTimeout(options.timeoutMs, () => request.destroy(new DeliveryError("SNS certificate request timed out", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent")));
        request.on("error", error => reject(error instanceof DeliveryError ? error : new DeliveryError("SNS certificate request failed", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent")));
        request.end();
    });
}
async function certificate(message, options) {
    const url = snsCertificateUrl(message.SigningCertURL, message.TopicArn);
    const now = options.now?.() ?? Date.now();
    const cached = certCache.get(url.href);
    if (cached && cached.expires > now)
        return cached.pem;
    let addresses;
    try {
        addresses = await (options.dnsResolver ?? defaultResolve)(url.hostname);
    }
    catch {
        throw new DeliveryError("SNS certificate host could not be resolved", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent");
    }
    if (!addresses.length || addresses.some(address => !publicAddress(address)))
        throw new DeliveryError("SNS certificate host resolved to an unsafe address", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent");
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
        throw new DeliveryError("Invalid SNS certificate timeout", "WEBHOOK_INVALID", "not-sent");
    const result = await (options.certificateFetcher ?? pinnedCertificateFetch)(url.href, {
        address: addresses[0],
        servername: url.hostname,
        timeoutMs,
        maxBytes: MAX_CERT_BYTES,
    });
    if (result.status >= 300 && result.status < 400)
        throw new DeliveryError("SNS certificate redirects are not allowed", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent");
    if (result.status !== 200)
        throw new DeliveryError("SNS certificate request failed", "WEBHOOK_CERTIFICATE_FETCH_FAILED", "not-sent");
    const pem = typeof result.body === "string" ? result.body : new TextDecoder().decode(result.body);
    if (Buffer.byteLength(pem) > MAX_CERT_BYTES)
        throw new DeliveryError("SNS certificate is too large", "WEBHOOK_CERTIFICATE_INVALID", "not-sent");
    let parsed;
    try {
        parsed = new X509Certificate(pem);
    }
    catch {
        throw new DeliveryError("SNS signing certificate is invalid", "WEBHOOK_CERTIFICATE_INVALID", "not-sent");
    }
    if (parsed.publicKey.asymmetricKeyType !== "rsa" || parsed.validTo === "Invalid Date" ||
        Date.parse(parsed.validFrom) > now || Date.parse(parsed.validTo) <= now) {
        throw new DeliveryError("SNS signing certificate is invalid or expired", "WEBHOOK_CERTIFICATE_INVALID", "not-sent");
    }
    const ttl = Math.max(0, Math.min(options.cacheTtlMs ?? CERT_CACHE_MS, CERT_CACHE_MS));
    if (ttl)
        certCache.set(url.href, { pem, expires: Math.min(now + ttl, Date.parse(parsed.validTo)) });
    return pem;
}
function canonicalMessage(message) {
    const type = message.Type;
    const fields = type === "Notification"
        ? ["Message", "MessageId", ...(message.Subject === undefined ? [] : ["Subject"]), "Timestamp", "TopicArn", "Type"]
        : type === "SubscriptionConfirmation" || type === "UnsubscribeConfirmation"
            ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
            : [];
    if (!fields.length || fields.some(field => typeof message[field] !== "string")) {
        throw new DeliveryError("SNS message fields are invalid", "WEBHOOK_INVALID", "not-sent");
    }
    return fields.map(field => `${field}\n${String(message[field])}\n`).join("");
}
export async function verifySesSnsSignature(message, options) {
    const topic = message.TopicArn;
    if (!options.expectedTopicArns.length || typeof topic !== "string" || !options.expectedTopicArns.includes(topic)) {
        throw new DeliveryError("SNS topic is not allowed", "WEBHOOK_TOPIC_REJECTED", "not-sent");
    }
    if (message.SignatureVersion !== "1" && message.SignatureVersion !== "2")
        throw new DeliveryError("Unsupported SNS signature version", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    if (typeof message.Signature !== "string" || message.Signature.length > 4096)
        throw new DeliveryError("Invalid SNS signature", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    const pem = await certificate(message, options);
    try {
        // AWS SNS still emits SignatureVersion 1. SHA-1 is used only to verify
        // those legacy SNS signatures after strict topic, certificate URL, DNS,
        // TLS, and certificate validity checks; it is never used for hashing
        // passwords, issuing tokens, or creating signatures.
        const verifier = createVerify(message.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256");
        verifier.update(canonicalMessage(message), "utf8");
        verifier.end();
        return verifier.verify(pem, message.Signature, "base64");
    }
    catch {
        return false;
    }
}
export async function parseSesSnsWebhook(rawBody, options) {
    const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
    if (Buffer.byteLength(text) > MAX_WEBHOOK_BYTES)
        throw new DeliveryError("Webhook body is too large", "WEBHOOK_TOO_LARGE", "not-sent");
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new DeliveryError("Invalid SNS JSON", "WEBHOOK_INVALID", "not-sent");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new DeliveryError("Invalid SNS message", "WEBHOOK_INVALID", "not-sent");
    const message = value;
    const topic = message.TopicArn;
    if (!options.expectedTopicArns.length || typeof topic !== "string" || !options.expectedTopicArns.includes(topic)) {
        throw new DeliveryError("SNS topic is not allowed", "WEBHOOK_TOPIC_REJECTED", "not-sent");
    }
    const verified = options.verifySignature ? await options.verifySignature(message) : await verifySesSnsSignature(message, options);
    if (!verified)
        throw new DeliveryError("SNS signature verification failed", "WEBHOOK_UNAUTHENTICATED", "not-sent");
    return message;
}
//# sourceMappingURL=webhooks.js.map