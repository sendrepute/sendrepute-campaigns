import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import nodemailer from "nodemailer";
import { DeliveryError } from "./types.js";
import { publicAddress } from "./validate.js";
async function defaultResolve(host) {
    if (isIP(host))
        return [host];
    const [v4, v6] = await Promise.all([resolve4(host).catch(() => []), resolve6(host).catch(() => [])]);
    return [...v4, ...v6];
}
async function transport(config, options) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
        throw new DeliveryError("timeoutMs must be between 1 and 120000", "INVALID_OPTIONS", "not-sent");
    }
    let addresses;
    try {
        addresses = await Promise.race([
            (options.dnsResolver ?? defaultResolve)(config.host),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new DeliveryError("SMTP DNS resolution timed out", "SMTP_TIMEOUT", "not-sent", undefined, true)), timeoutMs);
                timer.unref();
            }),
        ]);
    }
    catch (error) {
        if (error instanceof DeliveryError)
            throw error;
        throw new DeliveryError("SMTP host could not be resolved", "SMTP_DNS_FAILED", "not-sent", undefined, true);
    }
    if (!addresses.length)
        throw new DeliveryError("SMTP host did not resolve", "SMTP_DNS_FAILED", "not-sent", undefined, true);
    if (addresses.some(address => !isIP(address) || (!config.allowPrivateHost && !publicAddress(address))))
        throw new DeliveryError("SMTP host resolves to a private, reserved or invalid address", "SMTP_SSRF_BLOCKED", "not-sent");
    // Pin the first validated address for the connection. TLS still authenticates the configured hostname.
    const settings = {
        host: addresses[0], port: config.port, secure: config.secure ?? false,
        requireTLS: config.requireTls ?? (!config.secure && process.env.NODE_ENV === "production"),
        tls: { servername: config.host, rejectUnauthorized: true },
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
        ...(config.username ? { auth: { user: config.username, pass: config.password } } : {}),
    };
    return options.smtpTransportFactory?.(settings) ?? nodemailer.createTransport(settings);
}
export async function sendSmtp(config, message, options) {
    const client = await transport(config, options);
    try {
        const result = await client.sendMail({
            envelope: { from: message.from.email, to: [message.to.email] },
            from: message.from.name ? { address: message.from.email, name: message.from.name } : message.from.email,
            to: message.to.name ? { address: message.to.email, name: message.to.name } : message.to.email,
            subject: message.subject, html: message.html, text: message.text, headers: message.headers,
            messageId: message.id.includes("@") ? message.id : undefined,
        });
        const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : [];
        if (rejected.includes(message.to.email))
            throw new DeliveryError("SMTP server rejected the recipient", "SMTP_REJECTED", "rejected");
        if (!Array.isArray(result.accepted) || !result.accepted.map(String).includes(message.to.email))
            throw new DeliveryError("SMTP result did not confirm recipient acceptance", "SMTP_UNKNOWN", "unknown");
        return { providerMessageId: result.messageId, status: "accepted" };
    }
    catch (error) {
        if (error instanceof DeliveryError)
            throw error;
        const code = Number(error.responseCode);
        const definitive = code >= 500 && code <= 599;
        throw new DeliveryError(definitive ? "SMTP server rejected the message" : "SMTP delivery outcome is unknown", definitive ? "SMTP_REJECTED" : "SMTP_UNKNOWN", definitive ? "rejected" : "unknown");
    }
    finally {
        client.close();
    }
}
export async function verifySmtp(config, options) {
    const client = await transport(config, options);
    try {
        await client.verify();
    }
    catch (error) {
        const responseCode = Number(error.responseCode);
        const code = String(error.code ?? "");
        if (responseCode === 535 || code === "EAUTH")
            throw new DeliveryError("SMTP authentication failed", "SMTP_AUTH_FAILED", "not-sent", responseCode);
        if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT")
            throw new DeliveryError("SMTP verification timed out", "SMTP_TIMEOUT", "not-sent", undefined, true);
        if (code === "ETLS" || code === "ESOCKET")
            throw new DeliveryError("SMTP TLS verification failed", "SMTP_TLS_FAILED", "not-sent");
        throw new DeliveryError("SMTP verification failed", "SMTP_VERIFY_FAILED", "not-sent", Number.isFinite(responseCode) ? responseCode : undefined);
    }
    finally {
        client.close();
    }
}
//# sourceMappingURL=smtp.js.map