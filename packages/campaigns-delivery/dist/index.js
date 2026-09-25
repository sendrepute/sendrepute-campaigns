import { sendMailjet, sendSmtpCom, verifyMailjet, verifySmtpCom } from "./api-providers.js";
import { sendSes, verifySes } from "./ses.js";
import { sendSmtp, verifySmtp } from "./smtp.js";
import { sendNativeApi, verifyNativeApi } from "./native-providers.js";
import { validateConfig, validateMessage } from "./validate.js";
export * from "./types.js";
export * from "./webhooks.js";
export * from "./provider-analytics.js";
export async function sendMessage(config, message, options = {}) {
    validateConfig(config);
    validateMessage(message);
    switch (config.type) {
        case "smtp": return sendSmtp(config, message, options);
        case "ses": return sendSes(config, message, options);
        case "mailjet": return sendMailjet(config, message, options);
        case "smtpcom": return sendSmtpCom(config, message, options);
        case "sendgrid":
        case "mailgun":
            return sendNativeApi(config, message, options);
        case "postmark":
            if (config.transport === "smtp")
                return sendSmtp({ type: "smtp", host: "smtp.postmarkapp.com", port: 587, secure: false, requireTls: true, username: config.serverToken, password: config.serverToken }, message, options);
            return sendNativeApi(config, message, options);
        case "resend":
        case "brevo":
            return sendNativeApi(config, message, options);
    }
}
export async function verifyProvider(config, options = {}) {
    validateConfig(config);
    switch (config.type) {
        case "smtp":
            await verifySmtp(config, options);
            break;
        case "ses":
            await verifySes(config, options);
            break;
        case "mailjet":
            await verifyMailjet(config, options);
            break;
        case "smtpcom":
            await verifySmtpCom(config, options);
            break;
        case "sendgrid":
        case "mailgun":
            return { ok: true, provider: config.type, verification: await verifyNativeApi(config, options) };
        case "postmark":
            if (config.transport === "smtp") {
                await verifySmtp({ type: "smtp", host: "smtp.postmarkapp.com", port: 587, secure: false, requireTls: true, username: config.serverToken, password: config.serverToken }, options);
                break;
            }
            return { ok: true, provider: config.type, verification: await verifyNativeApi(config, options) };
        case "resend":
        case "brevo": {
            const verification = await verifyNativeApi(config, options);
            return { ok: true, provider: config.type, verification };
        }
    }
    return { ok: true, provider: config.type };
}
//# sourceMappingURL=index.js.map