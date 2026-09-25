import type { Transporter } from "nodemailer";
export interface Address {
    email: string;
    name?: string;
}
export interface DeliveryMessage {
    id: string;
    from: Address;
    to: Address;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
}
export interface SmtpProviderConfig {
    type: "smtp";
    host: string;
    port: number;
    secure?: boolean;
    username?: string;
    password?: string;
    requireTls?: boolean;
    allowPrivateHost?: boolean;
}
export interface SesProviderConfig {
    type: "ses";
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    configurationSetName?: string;
    /** SNS topics accepted by webhook verification; not used while sending. */
    snsTopicArns?: readonly string[];
}
export interface MailjetProviderConfig {
    type: "mailjet";
    apiKey: string;
    secretKey: string;
    /** Mailjet supports either its HTTPS Send API or its SMTP relay. */
    transport?: "api" | "smtp";
    /** Mailjet SMTP submission port. Defaults to STARTTLS on 587. */
    smtpPort?: 465 | 587;
}
export interface SmtpComProviderConfig {
    type: "smtpcom";
    apiKey: string;
    channel: string;
}
export interface SendGridProviderConfig {
    type: "sendgrid";
    apiKey: string;
}
export interface MailgunProviderConfig {
    type: "mailgun";
    apiKey: string;
    domain: string;
    region?: "us" | "eu";
}
export interface PostmarkProviderConfig {
    type: "postmark";
    serverToken: string;
    /** Postmark supports its HTTPS API or token-authenticated SMTP relay. */
    transport?: "api" | "smtp";
}
export interface ResendProviderConfig {
    type: "resend";
    apiKey: string;
}
export interface BrevoProviderConfig {
    type: "brevo";
    apiKey: string;
}
export type ProviderConfig = SmtpProviderConfig | SesProviderConfig | MailjetProviderConfig | SmtpComProviderConfig | SendGridProviderConfig | MailgunProviderConfig | PostmarkProviderConfig | ResendProviderConfig | BrevoProviderConfig;
export type DeliveryStatus = "accepted" | "rejected" | "unknown";
export interface DeliveryResult {
    providerMessageId?: string;
    status: DeliveryStatus;
}
export interface VerificationResult {
    ok: true;
    provider: ProviderConfig["type"];
    /** Some send-only keys cannot access a non-sending read endpoint. */
    verification?: "verified" | "inconclusive";
}
export interface DnsResolver {
    (hostname: string): Promise<readonly string[]>;
}
export interface DeliveryOptions {
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
    dnsResolver?: DnsResolver;
    smtpTransportFactory?: (options: Record<string, unknown>) => Pick<Transporter, "sendMail" | "verify" | "close">;
}
export type DeliveryFailureState = "not-sent" | "rejected" | "unknown";
export declare class DeliveryError extends Error {
    readonly code: string;
    readonly deliveryState: DeliveryFailureState;
    readonly statusCode?: number;
    /** True only when the transport proves no message was accepted and the failure is transient. */
    readonly retryable: boolean;
    constructor(message: string, code: string, deliveryState: DeliveryFailureState, statusCode?: number, retryable?: boolean);
}
//# sourceMappingURL=types.d.ts.map