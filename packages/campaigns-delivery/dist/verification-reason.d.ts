export type VerificationCategory = "authentication" | "permission" | "rate_limited" | "timeout" | "dns" | "tls" | "network" | "endpoint" | "configuration" | "provider" | "unavailable";
export interface VerificationFailure {
    errorCategory: VerificationCategory;
    reason: string;
    providerHttpStatus?: number;
}
/** Only locally observed, allowlisted facts are returned. Never forward an upstream body or exception text. */
export declare function verificationFailure(error: unknown): VerificationFailure;
//# sourceMappingURL=verification-reason.d.ts.map