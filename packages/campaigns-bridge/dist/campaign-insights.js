export const insightCountKeys = ["sent", "delivered", "bounced", "hardBounced", "softBounced", "deferred", "failed", "opened", "uniqueOpened", "clicked", "uniqueClicked", "unsubscribed", "complaints", "accepted", "pending"];
export const insightRateKeys = ["deliveryRate", "openRate", "clickRate", "bounceRate", "unsubscribeRate", "complaintRate"];
export const campaignInsightsCapabilities = {
    quote: { method: "POST", path: "/v1/campaign-insights/quote", scope: "ai:generate", billable: false },
    analyze: { method: "POST", path: "/v1/campaign-insights/analyze", scope: "ai:generate", billable: true },
};
export function validateInsightMetrics(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new TypeError("Aggregate metrics are required");
    const entries = Object.entries(input);
    if (!entries.length || entries.length > 30)
        throw new TypeError("Between 1 and 30 aggregate metrics are required");
    for (const [key, value] of entries) {
        const count = insightCountKeys.includes(key);
        const rate = insightRateKeys.includes(key);
        if ((!count && !rate) || typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
            (count ? !Number.isInteger(value) || value > 1e9 : value > 100))
            throw new TypeError("Invalid aggregate metric");
    }
}
export function validateInsightQuote(value) {
    const quote = value;
    if (!quote || ![5000, 10000].includes(quote.priceMillicents) || quote.currency !== "USD" ||
        typeof quote.vip !== "boolean" || quote.retentionDays !== 30 ||
        quote.priceMillicents !== (quote.vip ? 5000 : 10000))
        throw new TypeError("Invalid authoritative campaign insight quote");
}
export function validateInsightResult(value) {
    const response = value;
    if (!response || !/^[A-Za-z0-9_-]{16,128}$/.test(response.analysisId) ||
        ![5000, 10000].includes(response.priceMillicents) || !Number.isFinite(Date.parse(response.expiresAt)))
        throw new TypeError("Invalid campaign insight response");
    const result = response.result;
    const safe = (text) => typeof text === "string" && text.length > 0 && text.length <= 2000 &&
        !/[<>\u0000-\u001f\u007f]|https?:|www\.|@|javascript:|data:/i.test(text);
    if (!result || !safe(result.summary) || [result.findings, result.recommendations, result.limitations].some(items => !Array.isArray(items) || items.length > 5 || !items.every(safe)))
        throw new TypeError("Invalid campaign insight content");
    const text = [result.summary, ...result.findings, ...result.recommendations, ...result.limitations].join(" ");
    if (text.length > 4800 || text.trim().split(/\s+/u).length > 800)
        throw new TypeError("Campaign insight exceeds output limit");
}
//# sourceMappingURL=campaign-insights.js.map