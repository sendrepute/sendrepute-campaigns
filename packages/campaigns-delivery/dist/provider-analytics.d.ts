import type { DeliveryOptions, ProviderConfig } from "./types.js";
export type ProviderAnalyticsEventType = "delivered" | "opened" | "clicked" | "hard_bounce" | "soft_bounce" | "complained" | "unsubscribed";
export interface ProviderAnalyticsEvent {
    provider: ProviderConfig["type"];
    providerMessageId: string;
    type: ProviderAnalyticsEventType;
    occurredAt: string;
    recipient?: string;
    link?: string;
    canonicalFingerprint: string;
    metadata?: Record<string, unknown>;
}
export type ProviderAnalyticsAvailability = "poll" | "webhook" | "poll_and_webhook" | "unavailable";
export interface ProviderAnalyticsCapability {
    availability: ProviderAnalyticsAvailability;
    metrics: Readonly<Record<ProviderAnalyticsEventType, boolean>>;
    reason?: string;
}
export interface ProviderAnalyticsSyncRequest {
    cursor?: string | null;
    limit?: number;
    /** Required by providers, such as Resend, that expose per-message reads only. */
    providerMessageIds?: readonly string[];
    now?: Date;
}
export interface ProviderAnalyticsSyncResult {
    events: ProviderAnalyticsEvent[];
    nextCursor: string | null;
    hasMore: boolean;
}
export type ProviderAnalyticsErrorKind = "authentication" | "permission" | "rate_limited" | "unavailable" | "provider";
export declare class ProviderAnalyticsError extends Error {
    readonly kind: ProviderAnalyticsErrorKind;
    readonly statusCode?: number | undefined;
    constructor(message: string, kind: ProviderAnalyticsErrorKind, statusCode?: number | undefined);
}
export declare function providerAnalyticsCapability(type: ProviderConfig["type"]): ProviderAnalyticsCapability;
export declare function providerAnalyticsEventKey(value: ProviderAnalyticsEvent): string;
/** Normalizes already-authenticated webhook bodies. Signature/token validation remains provider-specific. */
export declare function normalizeProviderAnalyticsWebhook(type: ProviderConfig["type"], payload: unknown): ProviderAnalyticsEvent[];
export declare function syncProviderAnalytics(config: ProviderConfig, request?: ProviderAnalyticsSyncRequest, options?: DeliveryOptions): Promise<ProviderAnalyticsSyncResult>;
//# sourceMappingURL=provider-analytics.d.ts.map