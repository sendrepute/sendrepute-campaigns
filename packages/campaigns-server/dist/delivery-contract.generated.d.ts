export type DeliveryJobState = "queued" | "sending" | "sent" | "rejected" | "unknown" | "cancelled";
export interface DeliveryJobContract {
    id: string;
    campaignId: string | null;
    recipientId: string | null;
    kind: string;
    state: DeliveryJobState;
    runAt: string;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    providerMessageId: string | null;
    lastErrorCode: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}
export interface DeliveryEventContract {
    id: string;
    type: string;
    source: "worker" | "provider" | "operator" | "system";
    attempt: number | null;
    providerMessageId: string | null;
    errorCode: string | null;
    metadata: Record<string, unknown>;
    actorId: string | null;
    occurredAt: string;
    recordedAt: string;
}
export interface DeliveryReconcileRequest {
    outcome: "accepted" | "rejected";
    confirmation: "RECONCILE_UNKNOWN_DELIVERY";
    note?: string;
}
export interface DeliveryRetryRequest {
    confirmation: "RETRY_REJECTED_DELIVERY";
}
export type TelegramNotificationEventType = "started" | "completed" | "failed" | "opened" | "clicked";
export interface TelegramNotificationSettingsContract {
    enabled: boolean;
    configured: boolean;
    chatIdMasked: string | null;
    eventTypes: TelegramNotificationEventType[];
}
export interface PutTelegramNotificationSettingsRequest {
    enabled: boolean;
    eventTypes: TelegramNotificationEventType[];
    /** Write-only. Omit to retain the configured value. */
    botToken?: string;
    /** Write-only. Omit to retain the configured value. */
    chatId?: string;
}
export interface TestTelegramNotificationRequest {
    confirmation: "SEND_TELEGRAM_TEST";
}
export declare const deliveryContractOperations: {
    readonly listDeliveryJobs: readonly ["GET", "/delivery/jobs"];
    readonly getDeliveryJob: readonly ["GET", "/delivery/jobs/{jobId}"];
    readonly reconcileUnknownDelivery: readonly ["POST", "/delivery/jobs/{jobId}/reconcile"];
    readonly retryRejectedDelivery: readonly ["POST", "/delivery/jobs/{jobId}/retry"];
    readonly getDeliveryReport: readonly ["GET", "/reports/delivery"];
    readonly getTelegramNotificationSettings: readonly ["GET", "/notifications/telegram"];
    readonly putTelegramNotificationSettings: readonly ["PUT", "/notifications/telegram"];
    readonly testTelegramNotification: readonly ["POST", "/notifications/telegram/test"];
};
//# sourceMappingURL=delivery-contract.generated.d.ts.map