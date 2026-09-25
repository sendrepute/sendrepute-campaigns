import { type DeliveryMessage, type DeliveryOptions, type DeliveryResult, type SesProviderConfig } from "./types.js";
export declare function sendSes(config: SesProviderConfig, message: DeliveryMessage, options: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifySes(config: SesProviderConfig, options: DeliveryOptions): Promise<void>;
//# sourceMappingURL=ses.d.ts.map