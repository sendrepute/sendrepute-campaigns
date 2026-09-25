import { type DeliveryMessage, type ProviderConfig } from "./types.js";
/** Only globally routable DNS answers may be pinned for outbound requests. */
export declare function publicAddress(ip: string): boolean;
export declare function validateConfig(config: ProviderConfig): void;
export declare function validateMessage(message: DeliveryMessage): void;
//# sourceMappingURL=validate.d.ts.map