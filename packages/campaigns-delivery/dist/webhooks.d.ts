import { type DnsResolver } from "./types.js";
export declare function parseTokenWebhook(provider: "mailjet" | "smtpcom", rawBody: string | Uint8Array, actualToken: string, expectedToken: string): unknown;
export interface SnsCertificateFetchRequest {
    /** DNS result already checked as public and pinned for this request. */
    address: string;
    servername: string;
    timeoutMs: number;
    maxBytes: number;
}
export type SnsCertificateFetcher = (url: string, request: SnsCertificateFetchRequest) => Promise<{
    status: number;
    body: string | Uint8Array;
}>;
export interface SesSnsWebhookOptions {
    expectedTopicArns: readonly string[];
    verifySignature?: (message: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
    dnsResolver?: DnsResolver;
    certificateFetcher?: SnsCertificateFetcher;
    timeoutMs?: number;
    cacheTtlMs?: number;
    now?: () => number;
}
export declare function verifySesSnsSignature(message: Readonly<Record<string, unknown>>, options: SesSnsWebhookOptions): Promise<boolean>;
export declare function parseSesSnsWebhook(rawBody: string | Uint8Array, options: SesSnsWebhookOptions): Promise<Readonly<Record<string, unknown>>>;
//# sourceMappingURL=webhooks.d.ts.map