import { type OperationId, type OperationInput, type OperationResponse } from "./generated/operations.js";
export type { OperationId, OperationInput, OperationMap, OperationResponse, } from "./generated/operations.js";
export * from "./generated/operations.js";
export interface SendReputeClientOptions {
    apiKey: string;
    baseUrl: string;
    timeoutMs?: number;
    maxRetries?: number;
    fetch?: typeof globalThis.fetch;
}
export interface RequestOptions {
    signal?: AbortSignal;
}
export declare class SendReputeError extends Error {
    readonly status: number | undefined;
    readonly code: string;
    readonly requestId: string | undefined;
    readonly retryAfterMs: number | undefined;
    constructor(options: {
        message: string;
        code: string;
        status?: number;
        requestId?: string;
        retryAfterMs?: number;
        cause?: unknown;
    });
}
export declare class SendReputeClient {
    #private;
    constructor(options: SendReputeClientOptions);
    request<T extends OperationId>(operationId: T, input?: OperationInput<T>, options?: RequestOptions): Promise<OperationResponse<T>>;
}
export type BuilderExportResult = import("./generated/operations.js").CustomerStandardBuilderExportResult | import("./generated/operations.js").CustomerNativeBuilderExportResult;
export declare function decodeExportBytes(result: BuilderExportResult): Uint8Array;
//# sourceMappingURL=index.d.ts.map