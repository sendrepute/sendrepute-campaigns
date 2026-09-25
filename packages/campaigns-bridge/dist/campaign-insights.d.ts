export declare const insightCountKeys: readonly ["sent", "delivered", "bounced", "hardBounced", "softBounced", "deferred", "failed", "opened", "uniqueOpened", "clicked", "uniqueClicked", "unsubscribed", "complaints", "accepted", "pending"];
export declare const insightRateKeys: readonly ["deliveryRate", "openRate", "clickRate", "bounceRate", "unsubscribeRate", "complaintRate"];
export type InsightMetrics = Partial<Record<typeof insightCountKeys[number] | typeof insightRateKeys[number], number>>;
export interface InsightQuote {
    priceMillicents: 10000 | 5000;
    currency: "USD";
    vip: boolean;
    retentionDays: 30;
}
export interface InsightResult {
    analysisId: string;
    priceMillicents: number;
    result: {
        summary: string;
        findings: string[];
        recommendations: string[];
        limitations: string[];
    };
    expiresAt: string;
}
export declare const campaignInsightsCapabilities: {
    readonly quote: {
        readonly method: "POST";
        readonly path: "/v1/campaign-insights/quote";
        readonly scope: "ai:generate";
        readonly billable: false;
    };
    readonly analyze: {
        readonly method: "POST";
        readonly path: "/v1/campaign-insights/analyze";
        readonly scope: "ai:generate";
        readonly billable: true;
    };
};
export declare function validateInsightMetrics(input: unknown): asserts input is InsightMetrics;
export declare function validateInsightQuote(value: unknown): asserts value is InsightQuote;
export declare function validateInsightResult(value: unknown): asserts value is InsightResult;
//# sourceMappingURL=campaign-insights.d.ts.map