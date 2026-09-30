import { type DeliveryMessage, type DeliveryOptions, type DeliveryResult, type MailjetProviderConfig, type SmtpComProviderConfig } from "./types.js";
export declare function sendMailjet(config: MailjetProviderConfig, message: DeliveryMessage, options: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifyMailjet(config: MailjetProviderConfig, options: DeliveryOptions): Promise<"verified" | "inconclusive">;
export declare function sendSmtpCom(config: SmtpComProviderConfig, message: DeliveryMessage, options: DeliveryOptions): Promise<DeliveryResult>;
export declare function verifySmtpCom(config: SmtpComProviderConfig, options: DeliveryOptions): Promise<"verified" | "inconclusive">;
//# sourceMappingURL=api-providers.d.ts.map