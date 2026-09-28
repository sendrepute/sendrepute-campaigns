import type { DeliveryOptions, MailjetProviderConfig } from "./types.js";
export interface MailjetReconciliationRequest {
    /** The exact application message/job ID sent as Mailjet CustomID (truncated to 255 at send time). */
    customId: string;
    /** Historical search start, RFC3339. Defaults to 90 days before toTs. */
    fromTs?: string;
    /** Historical search end, RFC3339. Defaults to now. */
    toTs?: string;
}
export interface MailjetReconciliationOptions extends DeliveryOptions {
    /** Maximum sequential pages (1–10); exhaustion is incomplete, never a match. */
    maxPages?: number;
    /** Number of records per page (1–100). */
    pageSize?: number;
    /** Aggregate response byte ceiling (1–1048576). */
    maxTotalBytes?: number;
    /** Wall-clock budget for the complete lookup (1–30000ms). */
    deadlineMs?: number;
    /** Clock override for fixed-window tests. */
    now?: Date;
}
export type MailjetReconciliationResult = {
    status: "matched";
    providerMessageId: string;
} | {
    status: "no_match" | "ambiguous" | "incomplete";
    reason: string;
};
/**
 * Read-only lookup against Mailjet's documented GET /v3/REST/message?CustomID=...
 * Never infer identity from an old rounded ID, recipient or timestamp. A missing
 * record can mean Mailjet has expired its history, not that the send failed.
 * Caller must independently authorize/audit any persistence and import history.
 */
export declare function reconcileMailjetMessage(config: MailjetProviderConfig, request: MailjetReconciliationRequest, options?: MailjetReconciliationOptions): Promise<MailjetReconciliationResult>;
//# sourceMappingURL=mailjet-reconciliation.d.ts.map