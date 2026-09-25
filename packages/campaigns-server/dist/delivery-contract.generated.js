export const deliveryContractOperations = {
    listDeliveryJobs: ["GET", "/delivery/jobs"],
    getDeliveryJob: ["GET", "/delivery/jobs/{jobId}"],
    reconcileUnknownDelivery: ["POST", "/delivery/jobs/{jobId}/reconcile"],
    retryRejectedDelivery: ["POST", "/delivery/jobs/{jobId}/retry"],
    getDeliveryReport: ["GET", "/reports/delivery"],
    getTelegramNotificationSettings: ["GET", "/notifications/telegram"],
    putTelegramNotificationSettings: ["PUT", "/notifications/telegram"],
    testTelegramNotification: ["POST", "/notifications/telegram/test"],
};
//# sourceMappingURL=delivery-contract.generated.js.map