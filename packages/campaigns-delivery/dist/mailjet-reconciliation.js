import { boundedFetch } from "./http.js";
import { parseMailjetJson } from "./mailjet-json.js";
import { ProviderAnalyticsError } from "./provider-analytics.js";
/**
 * Read-only lookup against Mailjet's documented GET /v3/REST/message?CustomID=...
 * Never infer identity from an old rounded ID, recipient or timestamp. A missing
 * record can mean Mailjet has expired its history, not that the send failed.
 * Caller must independently authorize/audit any persistence and import history.
 */
export async function reconcileMailjetMessage(config, request, options = {}) {
    if (config.type !== "mailjet" || config.transport === "smtp") {
        throw new ProviderAnalyticsError("Mailjet API credentials are required for reconciliation", "unavailable");
    }
    const customId = request.customId;
    if (typeof customId !== "string" || !customId.trim() || customId.length > 255 || customId !== customId.trim()) {
        throw new ProviderAnalyticsError("An exact Mailjet CustomID (1–255 characters) is required", "provider");
    }
    const { pageSize = 100, maxPages = 5, maxTotalBytes = 1_048_576, deadlineMs = 30_000 } = options;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10 ||
        !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 1_048_576 ||
        !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000) {
        throw new ProviderAnalyticsError("Invalid Mailjet reconciliation bounds", "provider");
    }
    // The message list has a provider-defined default date window. Always send
    // both documented historical filters, never silently rely on that default.
    const now = options.now ?? new Date();
    const to = request.toTs === undefined ? now : new Date(request.toTs);
    const from = request.fromTs === undefined ? new Date(to.valueOf() - 90 * 86_400_000) : new Date(request.fromTs);
    if (!Number.isFinite(now.valueOf()) || !Number.isFinite(to.valueOf()) || !Number.isFinite(from.valueOf()) ||
        (request.fromTs !== undefined && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(request.fromTs)) ||
        (request.toTs !== undefined && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(request.toTs)) ||
        from >= to || to > now || to.valueOf() - from.valueOf() > 90 * 86_400_000) {
        throw new ProviderAnalyticsError("Mailjet reconciliation requires a valid historical window of at most 90 days", "provider");
    }
    const deadline = Date.now() + deadlineMs;
    const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.secretKey}`).toString("base64")}`;
    let bytesRemaining = maxTotalBytes;
    let offset = 0;
    let candidate;
    for (let page = 0; page < maxPages; page++) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0 || bytesRemaining <= 0)
            return { status: "incomplete", reason: "Mailjet lookup deadline or byte budget exhausted" };
        const url = new URL("https://api.mailjet.com/v3/REST/message");
        url.searchParams.set("CustomID", customId);
        url.searchParams.set("ShowCustomID", "true");
        url.searchParams.set("FromTS", from.toISOString());
        url.searchParams.set("ToTS", to.toISOString());
        url.searchParams.set("Limit", String(pageSize));
        url.searchParams.set("Offset", String(offset));
        let response;
        try {
            response = await boundedFetch(url.toString(), {
                method: "GET", headers: { authorization, accept: "application/json" },
            }, {
                ...options,
                timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 10_000, remainingMs, 30_000)),
                maxResponseBytes: Math.min(options.maxResponseBytes ?? 1_048_576, bytesRemaining),
            }, "verify", parseMailjetJson);
        }
        catch {
            return { status: "incomplete", reason: "Mailjet lookup failed or exceeded its deadline/byte budget" };
        }
        if (!response.ok) {
            if (response.status === 401 || response.status === 403 || response.status === 429) {
                const kind = response.status === 401 ? "authentication" : response.status === 403 ? "permission" : "rate_limited";
                throw new ProviderAnalyticsError(`Mailjet reconciliation request failed (HTTP ${response.status})`, kind, response.status);
            }
            return { status: "incomplete", reason: `Mailjet lookup unavailable (HTTP ${response.status})` };
        }
        bytesRemaining -= Buffer.byteLength(response.text, "utf8");
        if (Date.now() > deadline)
            return { status: "incomplete", reason: "Mailjet lookup deadline exceeded" };
        const body = response.json;
        if (!body || typeof body !== "object" || Array.isArray(body))
            return { status: "incomplete", reason: "Invalid Mailjet message list" };
        const { Data: data, Count: count, Total: reportedTotal } = body;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length ||
            !Number.isSafeInteger(reportedTotal) || reportedTotal < data.length ||
            data.length > pageSize) {
            return { status: "incomplete", reason: "Invalid Mailjet pagination" };
        }
        for (const row of data) {
            if (!row || typeof row !== "object" || Array.isArray(row))
                return { status: "incomplete", reason: "Invalid Mailjet message record" };
            const record = row;
            // Mailjet's filter is not sufficient evidence by itself: insist that
            // ShowCustomID echoes the exact correlation on each returned record.
            if (record.CustomID !== customId)
                return { status: "incomplete", reason: "Mailjet did not confirm the exact CustomID" };
            const id = record.ID;
            if (typeof id !== "string" || !/^[1-9]\d{0,19}$/.test(id))
                return { status: "incomplete", reason: "Mailjet returned an invalid or imprecise message ID" };
            if (candidate !== undefined)
                return { status: "ambiguous", reason: "Multiple Mailjet messages share this CustomID" };
            candidate = id;
        }
        offset += data.length;
        // The Mailjet OpenAPI describes Total as the number of objects *in Data*,
        // not necessarily the full filtered count. A full page requires probing
        // the next offset even when Total equals Count. Some installations expose
        // a global Total instead: if it says more records exist, a short page
        // cannot establish uniqueness.
        if (data.length < pageSize) {
            if (reportedTotal > offset)
                return { status: "incomplete", reason: "Mailjet pagination reports unexamined messages" };
            return candidate ? { status: "matched", providerMessageId: candidate } : { status: "no_match", reason: "No retained Mailjet message has this CustomID in the selected window" };
        }
    }
    return { status: "incomplete", reason: "Mailjet lookup reached its page limit" };
}
//# sourceMappingURL=mailjet-reconciliation.js.map