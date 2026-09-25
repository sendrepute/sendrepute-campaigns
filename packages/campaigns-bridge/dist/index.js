import { SendReputeClient as PublishedClient, SendReputeError, } from "@sendrepute/node";
import { validateInsightMetrics, validateInsightQuote, validateInsightResult } from "./campaign-insights.js";
export * from "./campaign-insights.js";
if (typeof process === "undefined" ||
    process.release?.name !== "node" ||
    typeof process.versions?.node !== "string") {
    throw new Error("@workspace/campaigns-bridge is server-only and requires Node.js");
}
export const PRODUCTION_API_BASE_URL = "https://www.sendrepute.com/api/";
export const PRODUCTION_HOSTED_BUILDER_ORIGIN = new URL(PRODUCTION_API_BASE_URL).origin;
export const MAX_BRIDGE_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_BRIDGE_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BRIDGE_TIMEOUT_MS = 30_000;
// Rewrite All can make several paced batches and repair rounds. The short
// account/quote timeout aborts an otherwise healthy paid rewrite mid-flight.
// Allow the central eight-minute deadline plus transport/settlement headroom.
export const DEFAULT_AI_REWRITE_TIMEOUT_MS = 540_000;
// The central regular-template endpoint has a 90 second provider deadline.
// Leave room for validation and settlement while retaining the shorter default
// for activation, pricing, and all other operations.
export const DEFAULT_AI_GENERATION_TIMEOUT_MS = 120_000;
const MAX_BRIDGE_TIMEOUT_MS = 300_000;
export const operationCapabilities = {
    getCustomerApiModels: { method: "GET", path: "/v1/models", scope: "models:read", billable: false },
    getCustomerApiUsage: { method: "GET", path: "/v1/usage", scope: "usage:read", billable: false },
    classifyCustomerEmail: { method: "POST", path: "/v1/classify", scope: "classify", billable: true, consent: "priceAuthorization" },
    customerGetAccount: { method: "GET", path: "/v1/account", scope: "account:read", billable: false },
    customerGetAccountReferrals: { method: "GET", path: "/v1/account/referrals", scope: "account:read", billable: false },
    customerGetCreditLedger: { method: "GET", path: "/v1/account/ledger", scope: "billing:read", billable: false },
    customerListPaymentInvoices: { method: "GET", path: "/v1/payments/invoices", scope: "billing:read", billable: false },
    customerCreatePaymentInvoice: { method: "POST", path: "/v1/payments/invoices", scope: "billing:write", billable: false },
    customerDeletePaymentInvoice: { method: "DELETE", path: "/v1/payments/invoices/{invoiceId}", scope: "billing:write", billable: false },
    customerListPaymentMethods: { method: "GET", path: "/v1/payments/methods", scope: "billing:read", billable: false },
    customerGetActiveDepositOffer: { method: "GET", path: "/v1/payments/deposit-offer", scope: "billing:read", billable: false },
    customerRefreshMyPayments: { method: "POST", path: "/v1/payments/refresh", scope: "billing:write", billable: false },
    customerGetPricingSettings: { method: "GET", path: "/v1/pricing", scope: "catalog:read", billable: false },
    customerGetVipPlans: { method: "GET", path: "/v1/vip/plans", scope: "catalog:read", billable: false },
    customerGetVip: { method: "GET", path: "/v1/vip", scope: "vip:read", billable: false },
    customerPurchaseVip: { method: "POST", path: "/v1/vip/purchase", scope: "vip:purchase", billable: true, consent: "expectedPrice" },
    customerQuoteClassificationEdit: { method: "POST", path: "/v1/rewrite/quote", scope: "rewrite", billable: false, deprecated: true },
    customerQuoteManualClassificationEdit: { method: "POST", path: "/v1/classify/edit/quote", scope: "classify", billable: false },
    customerClassifyEmail: { method: "POST", path: "/v1/classify/edit", scope: "classify", billable: true, consent: "editQuote" },
    customerRewriteFlaggedTermsWithAi: { method: "POST", path: "/v1/rewrite", scope: "rewrite", billable: true, consent: "rewriteQuote" },
    customerQuoteAiRewrite: { method: "POST", path: "/v1/rewrite/ai-quote", scope: "rewrite", billable: false },
    customerCreateAiEmailTemplate: { method: "POST", path: "/v1/email-builder/ai-template", scope: "ai:generate", billable: true, consent: "expectedPrice" },
    customerCreateVipEmailTemplate: { method: "POST", path: "/v1/vip/email-template", scope: "ai:generate", billable: true, consent: "expectedPrice" },
    customerAccessEmailBuilder: { method: "POST", path: "/v1/email-builder/access", scope: "builder:write", billable: false },
    customerGetEmailBuilderAccess: { method: "GET", path: "/v1/email-builder/access/{accessId}", scope: "builder:read", billable: false },
    customerCloseEmailBuilderAccess: { method: "DELETE", path: "/v1/email-builder/access/{accessId}", scope: "builder:write", billable: false },
    customerCreateVipEmailBuilderAccess: { method: "POST", path: "/v1/vip/email-builder/access", scope: "vip:builder", billable: true, consent: "expectedPrice" },
    customerGetVipEmailBuilderAccess: { method: "GET", path: "/v1/vip/email-builder/access/{accessId}", scope: "builder:read", billable: false },
    customerDeleteVipEmailBuilderAccess: { method: "DELETE", path: "/v1/vip/email-builder/access/{accessId}", scope: "vip:builder", billable: false },
    customerStandardBuilderImport: { method: "POST", path: "/v1/email-builder/import", scope: "builder:write", billable: false },
    customerStandardBuilderValidate: { method: "POST", path: "/v1/email-builder/validate", scope: "builder:write", billable: false },
    customerStandardBuilderCompile: { method: "POST", path: "/v1/email-builder/compile", scope: "builder:write", billable: false },
    customerStandardBuilderExport: { method: "POST", path: "/v1/email-builder/export", scope: "builder:write", billable: false },
    customerNativeBuilderImport: { method: "POST", path: "/v1/vip/email-builder/import", scope: "vip:builder", billable: false },
    customerNativeBuilderValidate: { method: "POST", path: "/v1/vip/email-builder/validate", scope: "vip:builder", billable: false },
    customerNativeBuilderCompile: { method: "POST", path: "/v1/vip/email-builder/compile", scope: "vip:builder", billable: false },
    customerNativeBuilderExport: { method: "POST", path: "/v1/vip/email-builder/export", scope: "vip:builder", billable: false },
    customerListVipBuilderTemplates: { method: "GET", path: "/v1/vip/email-builder/templates", scope: "vip:read", billable: false },
    customerGetVipBuilderTemplate: { method: "GET", path: "/v1/vip/email-builder/templates/{templateId}", scope: "vip:read", billable: false },
    customerListStandardBuilderTemplates: { method: "GET", path: "/v1/email-builder/templates", scope: "catalog:read", billable: false },
    customerGetStandardBuilderTemplate: { method: "GET", path: "/v1/email-builder/templates/{templateId}", scope: "catalog:read", billable: false },
};
export const hostedBuilderCapability = {
    available: true,
    modes: ["standard", "vip"],
    integrationRequirements: [
        "A server-minted opaque token with a short expiry",
        "Single-use atomic redemption bound to account, design, and allowed action",
        "An allowlisted HTTPS audience and origin",
        "No customer API key or bearer secret in browser URLs, storage, or messages",
        "Explicit save/export callbacks with origin, schema, size, and replay validation",
    ],
};
function loopbackHostname(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
/**
 * Return an exact trusted hosted-editor origin. Production is pinned to the
 * origin of the published API endpoint; loopback exists only behind the
 * explicit client test seam.
 */
export function exactHostedBuilderOrigin(value, allowLoopback = false) {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== value)
            return null;
        if (url.origin === PRODUCTION_HOSTED_BUILDER_ORIGIN && url.protocol === "https:")
            return url.origin;
        if (allowLoopback && loopbackHostname(url.hostname) && (url.protocol === "http:" || url.protocol === "https:")) {
            return url.origin;
        }
        return null;
    }
    catch {
        return null;
    }
}
export function assertHostedBuilderLaunch(value, expectedState, expectedOrigin = PRODUCTION_HOSTED_BUILDER_ORIGIN, allowLoopback = false) {
    const body = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
    const trustedOrigin = exactHostedBuilderOrigin(expectedOrigin, allowLoopback);
    if (!body || !trustedOrigin || typeof body.launchUrl !== "string" ||
        body.state !== expectedState || typeof body.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(body.expiresAt))) {
        throw new CampaignsBridgeError("INVALID_RESPONSE", "SendRepute hosted builder launch response was invalid");
    }
    let launchUrl;
    try {
        launchUrl = new URL(body.launchUrl);
    }
    catch {
        throw new CampaignsBridgeError("INVALID_RESPONSE", "SendRepute hosted builder launch response was invalid");
    }
    const parameters = [...launchUrl.searchParams.keys()];
    // The browser receives only the central service's bounded, opaque one-time
    // handoff code. Do not infer authorization from cookies or merely from the
    // presence of a query string: exact origin, route, state, and query shape
    // are all part of this trust decision.
    if (launchUrl.origin !== trustedOrigin ||
        launchUrl.username || launchUrl.password ||
        launchUrl.pathname !== "/hosted-email-builder" ||
        launchUrl.hash || parameters.length !== 1 || parameters[0] !== "code" ||
        !launchUrl.searchParams.get("code") || launchUrl.searchParams.get("code").length > 256) {
        throw new CampaignsBridgeError("INVALID_RESPONSE", "SendRepute hosted builder launch response was invalid");
    }
    return {
        launchUrl: launchUrl.href,
        state: body.state,
        expiresAt: body.expiresAt,
    };
}
export class CampaignsBridgeError extends Error {
    code;
    status;
    requestId;
    retryAfterSeconds;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "CampaignsBridgeError";
        this.code = code;
        if (details.status !== undefined)
            this.status = details.status;
        if (details.requestId !== undefined)
            this.requestId = details.requestId;
        if (details.retryAfterSeconds !== undefined)
            this.retryAfterSeconds = details.retryAfterSeconds;
    }
}
function testBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new TypeError("test.baseUrl must be an absolute loopback URL");
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username || url.password || url.search || url.hash) {
        throw new TypeError("test.baseUrl must be an HTTP(S) loopback URL without credentials, query, or fragment");
    }
    return url.toString();
}
function plainObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
    return value;
}
function assertBoundedRequest(value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new TypeError("input must be JSON serializable");
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_BRIDGE_REQUEST_BYTES) {
        throw new CampaignsBridgeError("REQUEST_TOO_LARGE", "SendRepute request exceeds the bridge byte limit");
    }
}
function assertHostedBuilderHandoffInput(input, allowLoopback) {
    let returnOrigin;
    try {
        returnOrigin = new URL(input.returnOrigin);
    }
    catch {
        throw new CampaignsBridgeError("INVALID_RETURN_ORIGIN", "A canonical HTTPS return origin is required", { status: 400 });
    }
    const loopback = loopbackHostname(returnOrigin.hostname);
    if (!/^[a-f0-9]{64}$/.test(input.state) ||
        returnOrigin.origin !== input.returnOrigin ||
        returnOrigin.username || returnOrigin.password ||
        (returnOrigin.protocol !== "https:" && !(allowLoopback && loopback && returnOrigin.protocol === "http:")) ||
        (input.mode === "vip" && (typeof input.vipAccessId !== "string" || !input.initialDocument)) ||
        (input.mode !== "vip" && (input.vipAccessId !== undefined || input.initialDocument !== undefined))) {
        throw new CampaignsBridgeError(returnOrigin.origin !== input.returnOrigin || returnOrigin.username || returnOrigin.password ||
            (returnOrigin.protocol !== "https:" && !(allowLoopback && loopback && returnOrigin.protocol === "http:"))
            ? "INVALID_RETURN_ORIGIN"
            : "INVALID_INPUT", returnOrigin.origin !== input.returnOrigin || returnOrigin.username || returnOrigin.password ||
            (returnOrigin.protocol !== "https:" && !(allowLoopback && loopback && returnOrigin.protocol === "http:"))
            ? "A canonical HTTPS return origin is required"
            : "Invalid hosted builder handoff", { status: 400 });
    }
}
function bridgeTimeout(value) {
    const timeout = value ?? DEFAULT_BRIDGE_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_BRIDGE_TIMEOUT_MS) {
        throw new TypeError(`timeoutMs must be an integer between 1 and ${MAX_BRIDGE_TIMEOUT_MS}`);
    }
    return timeout;
}
async function boundedJson(response) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BRIDGE_RESPONSE_BYTES) {
        throw new CampaignsBridgeError("RESPONSE_TOO_LARGE", "SendRepute response exceeds the bridge byte limit", { status: response.status });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BRIDGE_RESPONSE_BYTES) {
        throw new CampaignsBridgeError("RESPONSE_TOO_LARGE", "SendRepute response exceeds the bridge byte limit", { status: response.status });
    }
    if (bytes.byteLength === 0)
        return null;
    try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : null;
    }
    catch {
        return null;
    }
}
function bodyWith(input, changes) {
    const source = plainObject(input, "input");
    return { ...source, body: { ...plainObject(source.body, "input.body"), ...changes } };
}
const REGULAR_AI_CATEGORIES = new Set(["newsletter", "transactional", "personal", "business", "custom"]);
const REGULAR_AI_SUBTYPES = {
    newsletter: new Set(["weekly-digest", "product-update", "promotion", "event-invitation"]),
    transactional: new Set(["order-confirmation", "shipping-update", "payment-receipt", "password-reset", "account-alert"]),
    personal: new Set(["invitation", "thank-you", "congratulations", "personal-update"]),
    business: new Set(["introduction", "announcement", "follow-up", "meeting-invitation"]),
    custom: new Set(["custom"]),
};
/**
 * The central regular generator does not treat category and subtype as two
 * independent OpenAPI enums. A written brief is the custom/custom variant;
 * presets use a category-owned subtype and reject caller text. Canonicalize the
 * one historical Campaigns shape before request identity is computed centrally.
 */
function centralOperationInput(operation, input) {
    if (operation !== "customerCreateAiEmailTemplate")
        return input;
    const source = plainObject(input, "input");
    const body = plainObject(source.body, "input.body");
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const category = body.category === undefined ? "custom" : body.category;
    const subtype = body.subtype === undefined ? (category === "custom" ? "custom" : undefined) : body.subtype;
    // Campaigns originally paired its free-form text editor with the newsletter
    // category. The real central validator rejects newsletter/custom; the text is
    // owned by custom/custom.
    if (content && subtype === "custom" && category !== "custom") {
        return { ...source, body: { ...body, content, category: "custom", subtype: "custom" } };
    }
    if (typeof category !== "string" || !REGULAR_AI_CATEGORIES.has(category) ||
        typeof subtype !== "string" || !REGULAR_AI_SUBTYPES[category]?.has(subtype)) {
        throw new CampaignsBridgeError("INVALID_AI_TEMPLATE_INPUT", "Custom generation requires category and subtype custom; presets require a subtype owned by their category", { status: 400 });
    }
    if (category === "custom" ? !content : content.length > 0) {
        throw new CampaignsBridgeError("INVALID_AI_TEMPLATE_INPUT", category === "custom"
            ? "Custom generation requires a non-empty content brief"
            : "Preset generation does not accept caller content", { status: 400 });
    }
    return { ...source, body: { ...body, ...(content ? { content } : {}), category, subtype } };
}
function sameFields(left, right, fields) {
    return fields.every(field => left[field] === right[field]);
}
function validRewriteQuote(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const quote = value;
    return (quote.mode === "single" || quote.mode === "all")
        && Number.isSafeInteger(quote.uniqueTermCount) && Number(quote.uniqueTermCount) > 0
        && Number.isSafeInteger(quote.minimumPerUniqueTermMillicents) && Number(quote.minimumPerUniqueTermMillicents) >= 0
        && Number.isSafeInteger(quote.minimumChargeMillicents) && Number(quote.minimumChargeMillicents) >= 0
        && Number.isSafeInteger(quote.maximumChargeMillicents)
        && Number(quote.maximumChargeMillicents) >= Number(quote.minimumChargeMillicents)
        && Number.isSafeInteger(quote.currentBalanceMillicents)
        && Number.isSafeInteger(quote.balanceAfterMaximumMillicents)
        && Number(quote.balanceAfterMaximumMillicents) === Number(quote.currentBalanceMillicents) - Number(quote.maximumChargeMillicents)
        && typeof quote.vipActive === "boolean";
}
function expectedPricing(pricing) {
    return {
        classificationBaseMillicents: pricing.classificationBaseMillicents,
        includedUniqueTerms: pricing.includedUniqueTerms,
        additionalTermMillicents: pricing.additionalTermMillicents,
        maximumClassificationMillicents: pricing.maximumClassificationMillicents,
    };
}
export class SendReputeClient {
    #client;
    #generationClient;
    #rewriteClient;
    #secret;
    #baseUrl;
    #fetch;
    #timeoutMs;
    async campaignInsightsQuote() {
        const result = await this.#insightsRequest("quote", {});
        validateInsightQuote(result);
        return result;
    }
    async campaignInsightsAnalyze(input) {
        validateInsightMetrics(input.metrics);
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.analysisId) || input.consent !== true ||
            ![5000, 10000].includes(input.expectedPriceMillicents))
            throw new TypeError("Explicit valid insight price consent is required");
        // Reconstruct the wire body: never forward campaign identifiers or arbitrary caller fields.
        const result = await this.#insightsRequest("analyze", {
            analysisId: input.analysisId, expectedPriceMillicents: input.expectedPriceMillicents,
            consent: true, metrics: input.metrics, locale: input.locale ?? "en",
        });
        validateInsightResult(result);
        if (result.analysisId !== input.analysisId || result.priceMillicents !== input.expectedPriceMillicents)
            throw new CampaignsBridgeError("INVALID_RESPONSE", "Campaign insight response identity mismatch", { status: 502 });
        return result;
    }
    async #insightsRequest(action, body) {
        const response = await this.#fetch(new URL(`v1/campaign-insights/${action}`, this.#baseUrl), {
            method: "POST", headers: { accept: "application/json", authorization: `Bearer ${this.#secret}`, "content-type": "application/json" },
            body: JSON.stringify(body), redirect: "manual",
            signal: AbortSignal.timeout(action === "analyze" ? DEFAULT_AI_GENERATION_TIMEOUT_MS : this.#timeoutMs),
        });
        if (response.status >= 300 && response.status < 400)
            throw new CampaignsBridgeError("REDIRECT_REFUSED", "SendRepute redirect refused", { status: 502 });
        const result = await boundedJson(response);
        if (!response.ok) {
            const code = result?.error?.code ?? "API_ERROR";
            throw new CampaignsBridgeError(code, `Campaign insights failed (${code})`, { status: response.status });
        }
        return result;
    }
    constructor(options) {
        if (!options || typeof options !== "object")
            throw new TypeError("Client options are required");
        if (typeof options.secret !== "string" || !options.secret.trim() || /[\r\n]/.test(options.secret)) {
            throw new TypeError("A valid server-side secret is required");
        }
        const baseUrl = options.test ? testBaseUrl(options.test.baseUrl) : PRODUCTION_API_BASE_URL;
        const timeoutMs = bridgeTimeout(options.timeoutMs);
        this.#secret = options.secret;
        this.#baseUrl = baseUrl;
        this.#fetch = options.test?.fetch ?? globalThis.fetch;
        if (typeof this.#fetch !== "function")
            throw new TypeError("A fetch implementation is required");
        this.#timeoutMs = timeoutMs;
        this.#client = new PublishedClient({
            apiKey: options.secret,
            baseUrl,
            timeoutMs,
            maxRetries: 0,
            ...(options.test?.fetch ? { fetch: options.test.fetch } : {}),
        });
        this.#generationClient = new PublishedClient({
            apiKey: options.secret,
            baseUrl,
            timeoutMs: options.timeoutMs === undefined ? DEFAULT_AI_GENERATION_TIMEOUT_MS : timeoutMs,
            maxRetries: 0,
            ...(options.test?.fetch ? { fetch: options.test.fetch } : {}),
        });
        this.#rewriteClient = new PublishedClient({
            apiKey: options.secret,
            baseUrl,
            timeoutMs: options.timeoutMs === undefined ? DEFAULT_AI_REWRITE_TIMEOUT_MS : timeoutMs,
            maxRetries: 0,
            ...(options.test?.fetch ? { fetch: options.test.fetch } : {}),
        });
    }
    async createHostedBuilderHandoff(input) {
        assertBoundedRequest(input);
        assertHostedBuilderHandoffInput(input, this.#baseUrl !== PRODUCTION_API_BASE_URL);
        const signal = AbortSignal.timeout(this.#timeoutMs);
        try {
            const response = await this.#fetch(new URL("v1/email-builder/hosted-handoffs", this.#baseUrl), {
                method: "POST",
                headers: { accept: "application/json", authorization: `Bearer ${this.#secret}`, "content-type": "application/json" },
                body: JSON.stringify(input),
                redirect: "manual",
                signal,
            });
            if (response.status >= 300 && response.status < 400) {
                throw new CampaignsBridgeError("REDIRECT_REFUSED", "SendRepute redirects are refused to protect credentials", { status: response.status });
            }
            const body = await boundedJson(response);
            if (!response.ok) {
                const rawCode = body?.error?.code;
                const upstreamCode = typeof rawCode === "string" && rawCode.length <= 128 ? rawCode : "API_ERROR";
                const code = response.status === 404 ? "HOSTED_BUILDER_NOT_DEPLOYED" : upstreamCode;
                const rawRequestId = response.headers.get("x-request-id") ?? body?.requestId;
                const requestId = typeof rawRequestId === "string" && rawRequestId.length <= 128 ? rawRequestId : undefined;
                throw new CampaignsBridgeError(code, response.status === 404
                    ? "The published SendRepute service does not support secure hosted builder launches yet"
                    : `SendRepute hosted builder launch failed with status ${response.status} (${code})`, { status: response.status, ...(requestId ? { requestId } : {}) });
            }
            return assertHostedBuilderLaunch(body, input.state, new URL(this.#baseUrl).origin, this.#baseUrl !== PRODUCTION_API_BASE_URL);
        }
        catch (error) {
            if (error instanceof CampaignsBridgeError)
                throw error;
            if (signal.aborted)
                throw new CampaignsBridgeError("REQUEST_TIMEOUT", "SendRepute request timed out; its billing outcome may be unknown", { status: 504 });
            throw new CampaignsBridgeError("REQUEST_FAILED", "SendRepute request failed", { status: 502 });
        }
    }
    async #request(operation, input) {
        const centralInput = centralOperationInput(operation, input ?? {});
        assertBoundedRequest(centralInput);
        try {
            const client = operation === "customerCreateAiEmailTemplate" ||
                operation === "customerCreateVipEmailTemplate"
                ? this.#generationClient
                : operation === "customerRewriteFlaggedTermsWithAi"
                    ? this.#rewriteClient
                    : this.#client;
            return await client.request(operation, centralInput);
        }
        catch (error) {
            if (error instanceof SendReputeError) {
                const status = error.status ??
                    (error.code === "REQUEST_TIMEOUT" ? 504
                        : error.code === "NETWORK_ERROR" || error.code === "INVALID_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"
                            ? 502
                            : undefined);
                throw new CampaignsBridgeError(error.code, error.code === "REQUEST_TIMEOUT"
                    ? "SendRepute request timed out; its billing outcome may be unknown"
                    : `SendRepute request failed${error.status === undefined ? "" : ` with status ${error.status}`} (${error.code})`, { status, requestId: error.requestId, ...(error.retryAfterMs !== undefined ? { retryAfterSeconds: Math.ceil(error.retryAfterMs / 1000) } : {}) });
            }
            throw new CampaignsBridgeError("REQUEST_FAILED", "SendRepute request failed", { status: 502 });
        }
    }
    /**
     * Free activation check. These GETs neither require a positive wallet balance
     * nor invoke classification, AI, email delivery, or a purchase.
     */
    async validateActivation() {
        const [account, pricing, usage] = await Promise.all([
            this.#request("customerGetAccount"),
            this.#request("customerGetPricingSettings"),
            this.#request("getCustomerApiUsage"),
        ]);
        if (account.disabled) {
            throw new CampaignsBridgeError("ACCOUNT_DISABLED", "SendRepute account is disabled", { status: 403 });
        }
        return {
            active: true,
            requiredScopes: ["account:read", "catalog:read", "usage:read"],
            account: {
                creditMillicents: account.creditMillicents,
                reorgDebtMillicents: account.reorgDebtMillicents,
                paymentHold: account.paymentHold,
                disabled: account.disabled,
            },
            pricing,
            usage,
        };
    }
    async getConnectionSnapshot() {
        const vipResult = this.#request("customerGetVip")
            .then(value => ({ known: true, value }))
            .catch(error => {
            // Account/catalog/usage validation remains authoritative. A forbidden
            // optional VIP read means only that VIP state is unavailable to this key.
            // A 404 is also optional for an older central deployment which does not
            // expose VIP status. Never swallow account-disabled or arbitrary 403s.
            if (error instanceof CampaignsBridgeError &&
                (error.status === 404 ||
                    (error.status === 403 && error.code === "INSUFFICIENT_SCOPE"))) {
                return { known: false };
            }
            throw error;
        });
        const [activation, vipState, plan] = await Promise.all([
            this.validateActivation(),
            vipResult,
            this.#request("customerGetVipPlans"),
        ]);
        const vip = vipState.known ? vipState.value : null;
        const prices = vip?.active
            ? vip.classifier
            : {
                baseMillicents: activation.pricing.classificationBaseMillicents,
                additionalTermMillicents: activation.pricing.additionalTermMillicents,
                maximumMillicents: activation.pricing.maximumClassificationMillicents,
                editTermMillicents: activation.pricing.editTermMillicents,
                removeAllMillicents: activation.pricing.removeAllMillicents,
            };
        return {
            balance: {
                availableMillicents: activation.account.creditMillicents,
                reorgDebtMillicents: activation.account.reorgDebtMillicents,
                paymentHold: activation.account.paymentHold,
            },
            usage: activation.usage,
            vip: {
                status: !vip ? "unknown" : vip.active ? "active" : "inactive",
                active: vip?.active ?? null,
                expiresAt: typeof vip?.expiresAt === "string" ? vip.expiresAt : null,
                availability: !vip ? "unknown" : vip.active ? "available" : "locked",
            },
            effectivePrices: {
                classifier: {
                    ...prices,
                    includedUniqueTerms: activation.pricing.includedUniqueTerms,
                },
                aiTemplateMillicents: vip?.regularAiTemplatePriceMillicents ?? null,
                nativeBuilderAccessMillicents: vip?.active
                    ? vip.templateAccessPriceMillicents
                    : plan.normalComparison.templateAccessPriceMillicents,
                vipMonthlyMillicents: plan.monthlyPriceMillicents,
            },
            capabilities: {
                operations: operationCapabilities,
                keyScopesIntrospectable: false,
                hostedBuilder: hostedBuilderCapability,
                availability: {
                    standardBuilder: "available",
                    vipBuilder: !vip ? "unknown" : vip.active ? "available" : "locked",
                    vipStatus: vip ? "available" : "locked",
                },
            },
        };
    }
    async execute(operation, input) {
        const capability = operationCapabilities[operation];
        if (!capability)
            throw new TypeError(`Unsupported SendRepute operation: ${String(operation)}`);
        const source = plainObject(input ?? {}, "input");
        const { consent, ...requestInput } = source;
        if (!capability.billable) {
            if (consent !== undefined)
                throw new TypeError("consent is accepted only for billable operations");
            return this.#request(operation, requestInput);
        }
        if (consent === undefined) {
            throw new CampaignsBridgeError("CONSENT_REQUIRED", `Operation requires ${capability.consent} consent`, { status: 402 });
        }
        const authorization = plainObject(consent, "input.consent");
        if (authorization.kind !== capability.consent) {
            throw new CampaignsBridgeError("CONSENT_REQUIRED", `Operation requires ${capability.consent} consent`, { status: 402 });
        }
        let authorizedInput = requestInput;
        if (operation === "classifyCustomerEmail") {
            const pricing = await this.#request("customerGetPricingSettings");
            const auth = authorization;
            if (!Number.isSafeInteger(auth.maxChargeMillicents) || auth.maxChargeMillicents < 0) {
                throw new CampaignsBridgeError("INVALID_PRICE_AUTHORIZATION", "Classification maximum charge must be a non-negative integer", { status: 400 });
            }
            const canonicalPricing = expectedPricing(pricing);
            if (!sameFields(auth.expectedPricing, canonicalPricing, [
                "classificationBaseMillicents",
                "includedUniqueTerms",
                "additionalTermMillicents",
                "maximumClassificationMillicents",
            ])) {
                throw new CampaignsBridgeError("PRICE_CHANGED", "Classification pricing changed; obtain fresh pricing and consent", { status: 409 });
            }
            authorizedInput = bodyWith(requestInput, {
                priceAuthorization: {
                    // Rebuild this strict nested object rather than forwarding legacy
                    // pricing response fields which the central validator rejects.
                    expectedPricing: canonicalPricing,
                    maxChargeMillicents: auth.maxChargeMillicents,
                },
            });
        }
        else if (authorization.kind === "expectedPrice") {
            const body = plainObject(requestInput.body, "input.body");
            if (body.expectedPriceMillicents !== undefined &&
                body.expectedPriceMillicents !== authorization.expectedPriceMillicents) {
                throw new CampaignsBridgeError("CONSENT_MISMATCH", "Body price and consent price do not match", { status: 400 });
            }
            let currentPrice;
            if (operation === "customerPurchaseVip") {
                currentPrice = (await this.#request("customerGetVipPlans")).monthlyPriceMillicents;
            }
            else {
                const vip = await this.#request("customerGetVip");
                currentPrice = operation === "customerCreateAiEmailTemplate"
                    ? vip.regularAiTemplatePriceMillicents
                    : operation === "customerCreateVipEmailTemplate"
                        ? vip.aiTemplatePriceMillicents
                        : vip.templateAccessPriceMillicents;
            }
            if (currentPrice !== authorization.expectedPriceMillicents) {
                throw new CampaignsBridgeError("PRICE_CHANGED", "Price changed; obtain a fresh snapshot and consent", { status: 409 });
            }
            authorizedInput = bodyWith(requestInput, {
                expectedPriceMillicents: authorization.expectedPriceMillicents,
            });
        }
        else if (operation === "customerClassifyEmail" && authorization.kind === "editQuote") {
            const body = plainObject(requestInput.body, "input.body");
            const quote = await this.#request("customerQuoteManualClassificationEdit", {
                body: {
                    parentRequestId: body.parentRequestId,
                    editMode: body.editMode,
                    terms: body.editedTerms,
                },
            });
            if (!sameFields(quote, authorization.expected, [
                "mode",
                "validatedTermCount",
                "originalAnalysisPaidMillicents",
                "editChargeMillicents",
                "sessionTotalMillicents",
                "currentBalanceMillicents",
                "balanceAfterMillicents",
            ])) {
                throw new CampaignsBridgeError("PRICE_CHANGED", "Edit quote changed; obtain fresh quote and consent", { status: 409 });
            }
        }
        else if (operation === "customerRewriteFlaggedTermsWithAi" && authorization.kind === "rewriteQuote") {
            const body = plainObject(requestInput.body, "input.body");
            const quote = await this.#request("customerQuoteAiRewrite", {
                body: {
                    parentRequestId: body.parentRequestId,
                    mode: body.mode,
                    terms: body.terms,
                },
            });
            if (!validRewriteQuote(quote)) {
                throw new CampaignsBridgeError("PRICE_UNAVAILABLE", "Authoritative AI rewrite pricing is unavailable", { status: 503 });
            }
            if (!sameFields(quote, authorization.expected, [
                "mode",
                "uniqueTermCount",
                "minimumPerUniqueTermMillicents",
                "minimumChargeMillicents",
                "maximumChargeMillicents",
                "currentBalanceMillicents",
                "balanceAfterMaximumMillicents",
                "vipActive",
            ])) {
                throw new CampaignsBridgeError("PRICE_CHANGED", "AI rewrite quote changed; obtain fresh quote and consent", { status: 409 });
            }
            authorizedInput = bodyWith(requestInput, {
                priceAuthorization: {
                    expectedMinimumPerUniqueTermMillicents: quote.minimumPerUniqueTermMillicents,
                    maximumChargeMillicents: quote.maximumChargeMillicents,
                },
            });
        }
        else if (operation === "customerRewriteFlaggedTermsWithAi") {
            throw new CampaignsBridgeError("CONSENT_REQUIRED", "An authoritative AI rewrite quote is required", { status: 402 });
        }
        return this.#request(operation, authorizedInput);
    }
}
//# sourceMappingURL=index.js.map