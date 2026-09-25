import type { DeliveryMessage, DeliveryOptions, DeliveryResult, ProviderConfig, VerificationResult } from "./types.js";
export * from "./types.js";
export * from "./webhooks.js";
export * from "./provider-analytics.js";
export declare function sendMessage(config: ProviderConfig, message: DeliveryMessage, options?: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifyProvider(config: ProviderConfig, options?: DeliveryOptions): Promise<VerificationResult>;
//# sourceMappingURL=index.d.ts.map