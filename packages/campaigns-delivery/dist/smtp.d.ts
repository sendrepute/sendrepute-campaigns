import { type DeliveryMessage, type DeliveryOptions, type DeliveryResult, type SmtpProviderConfig } from "./types.js";
export declare function sendSmtp(config: SmtpProviderConfig, message: DeliveryMessage, options: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifySmtp(config: SmtpProviderConfig, options: DeliveryOptions): Promise<void>;
//# sourceMappingURL=smtp.d.ts.map