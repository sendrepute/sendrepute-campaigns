import { type DeliveryOptions } from "./types.js";
export declare function boundedFetch(url: string, init: RequestInit, options: DeliveryOptions, operation: "send" | "verify"): Promise<{
    status: number;
    ok: boolean;
    json: unknown;
    text: string;
    header(name: string): string | null;
}>;
export declare function safeProviderError(status: number, _body: unknown): string;
export declare function httpFailureState(status: number): "rejected" | "unknown";
/** A provider's explicit throttle proves non-acceptance and is safe to retry. */
export declare function httpFailure(status: number): {
    state: "not-sent" | "rejected" | "unknown";
    retryable: boolean;
};
//# sourceMappingURL=http.d.ts.map