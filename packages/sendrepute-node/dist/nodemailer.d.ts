import { type CustomerClassificationPriceAuthorization, type SendReputeClient } from "./index.js";
export type SendReputeNodemailerPolicy = {
    paidAnalysisConsent: boolean;
    mode: "advisory" | "blocking";
    spamProbabilityThreshold: number;
    onApiFailure: "allow" | "block";
};
export type SendReputeNodemailerDiagnostic = {
    kind: "classification";
    action: "allowed" | "blocked";
    requestId?: string;
    model?: string;
    label: "inbox" | "spam";
    spamProbability: number;
    confidence?: "low" | "medium" | "high";
} | {
    kind: "api_failure";
    action: "allowed" | "blocked";
    errorName: string;
    status?: number;
    code?: string;
} | {
    kind: "unsupported_content";
    action: "allowed" | "blocked";
    code: "UNSUPPORTED_CONTENT";
};
export type SendReputeNodemailerOptions = {
    client: Pick<SendReputeClient, "request">;
    policy: SendReputeNodemailerPolicy;
    /**
     * Pricing reviewed and approved by the operator. Obtain all four effective
     * values from customerGetPricingSettings and choose a maximum charge for this
     * classification request. The adapter never updates this authorization.
     */
    priceAuthorization?: CustomerClassificationPriceAuthorization;
    model?: "thor" | "theos" | "athena" | "odin" | "freya" | "hermes" | "ares" | "apollo";
    sender?: string | ((message: Readonly<NodemailerMessageData>) => string);
    signal?: AbortSignal;
    onDiagnostic?: (diagnostic: SendReputeNodemailerDiagnostic) => void;
};
export type NodemailerMessageData = {
    from?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
    amp?: unknown;
    watchHtml?: unknown;
    icalEvent?: unknown;
    raw?: unknown;
    alternatives?: unknown;
    attachments?: unknown;
    envelope?: unknown;
};
export type NodemailerMail = {
    data: NodemailerMessageData;
};
export type NodemailerCallback<T = unknown> = (error: Error | null, result?: T) => void;
export type NodemailerTransport<T = unknown> = {
    name?: string;
    version?: string;
    send(mail: NodemailerMail, callback: NodemailerCallback<T>): unknown;
    close?: () => unknown;
    verify?: (...args: any[]) => unknown;
};
export declare class SendReputeNodemailerError extends Error {
    readonly code: "INVALID_POLICY" | "INVALID_MESSAGE" | "UNSUPPORTED_CONTENT" | "SPAM_BLOCKED" | "PRICE_CHANGED" | "API_FAILURE_BLOCKED";
    constructor(code: SendReputeNodemailerError["code"], message: string, options?: ErrorOptions);
}
export declare function createSendReputePlugin(options: SendReputeNodemailerOptions): (mail: NodemailerMail, callback: NodemailerCallback<void>) => void;
export declare function createSendReputeTransport<T>(transport: NodemailerTransport<T>, options: SendReputeNodemailerOptions): NodemailerTransport<T>;
//# sourceMappingURL=nodemailer.d.ts.map