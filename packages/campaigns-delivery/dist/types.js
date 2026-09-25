export class DeliveryError extends Error {
    code;
    deliveryState;
    statusCode;
    /** True only when the transport proves no message was accepted and the failure is transient. */
    retryable;
    constructor(message, code, deliveryState, statusCode, retryable = false) {
        super(message);
        this.name = "DeliveryError";
        this.code = code;
        this.deliveryState = deliveryState;
        this.statusCode = statusCode;
        this.retryable = deliveryState === "not-sent" && retryable;
    }
}
//# sourceMappingURL=types.js.map