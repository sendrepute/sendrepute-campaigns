import { type BrevoProviderConfig, type DeliveryMessage, type DeliveryOptions, type DeliveryResult, type MailgunProviderConfig, type PostmarkProviderConfig, type ResendProviderConfig, type SendGridProviderConfig } from "./types.js";
type NativeConfig = SendGridProviderConfig | MailgunProviderConfig | PostmarkProviderConfig | ResendProviderConfig | BrevoProviderConfig;
export declare function sendNativeApi(config: NativeConfig, message: DeliveryMessage, options: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifyNativeApi(config: NativeConfig, options: DeliveryOptions): Promise<"verified" | "inconclusive">;
export {};
//# sourceMappingURL=native-providers.d.ts.map