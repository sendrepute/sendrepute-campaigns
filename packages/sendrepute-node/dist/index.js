import { operationMetadata, } from "./generated/operations.js";
export * from "./generated/operations.js";
if (typeof process === "undefined" ||
    process.release?.name !== "node" ||
    typeof process.versions?.node !== "string") {
    throw new Error("@sendrepute/node is server-only and requires Node.js");
}
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
// Rewrite All can run paced batches and bounded repair rounds for up to eight
// minutes. Callers still opt in to a longer timeout; the default stays 30s.
const MAX_TIMEOUT_MS = 600_000;
const MAX_RETRIES = 10;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 30_000;
// This is deliberately operation-based rather than method-based. Keep it aligned
// with server operations that are read/delete idempotent, plus the classifier's
// documented account-scoped duplicate receipt protection.
const RETRY_SAFE_OPERATIONS = new Set([
    "getCustomerApiModels",
    "getCustomerApiUsage",
    "classifyCustomerEmail",
    "customerQuoteAiRewrite",
    "customerGetAccount",
    "customerGetAccountReferrals",
    "customerGetCreditLedger",
    "customerListPaymentInvoices",
    "customerDeletePaymentInvoice",
    "customerListPaymentMethods",
    "customerGetActiveDepositOffer",
    "customerGetPricingSettings",
    "customerGetVipPlans",
    "customerGetVip",
    "customerGetEmailBuilderAccess",
    "customerCloseEmailBuilderAccess",
    "customerGetVipEmailBuilderAccess",
    "customerDeleteVipEmailBuilderAccess",
    "customerListVipBuilderTemplates",
    "customerGetVipBuilderTemplate",
    "customerListStandardBuilderTemplates",
    "customerGetStandardBuilderTemplate",
]);
export class SendReputeError extends Error {
    status;
    code;
    requestId;
    retryAfterMs;
    constructor(options) {
        super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "SendReputeError";
        this.code = options.code;
        if (options.status !== undefined)
            this.status = options.status;
        if (options.requestId !== undefined)
            this.requestId = options.requestId;
        if (options.retryAfterMs !== undefined)
            this.retryAfterMs = options.retryAfterMs;
    }
}
function positiveInteger(value, name, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new TypeError(`${name} must be an integer between 0 and ${maximum}`);
    }
    return value;
}
function validatedBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new TypeError("baseUrl must be an absolute URL");
    }
    const loopback = (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
        url.protocol === "http:";
    if (url.protocol !== "https:" && !loopback) {
        throw new TypeError("baseUrl must use HTTPS (HTTP is allowed only for loopback testing)");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new TypeError("baseUrl must not include credentials, a query, or a fragment");
    }
    return new URL(url.toString().replace(/\/+$/, "") + "/");
}
function appendQuery(url, query) {
    if (query === undefined)
        return;
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("input.query must be an object");
    }
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined)
            continue;
        if (value === null || typeof value === "object") {
            throw new TypeError(`input.query.${key} must be a scalar`);
        }
        url.searchParams.append(key, String(value));
    }
}
function requestUrl(baseUrl, template, input) {
    const pathValues = input.path;
    const rendered = template.replace(/\{([^}]+)\}/g, (_, key) => {
        if (!pathValues || typeof pathValues !== "object" || !(key in pathValues)) {
            throw new TypeError(`Missing path parameter: ${key}`);
        }
        const value = pathValues[key];
        if (typeof value !== "string" && typeof value !== "number") {
            throw new TypeError(`Path parameter ${key} must be a string or number`);
        }
        return encodeURIComponent(String(value));
    });
    const url = new URL(rendered.replace(/^\//, ""), baseUrl);
    appendQuery(url, input.query);
    return url;
}
function retryAfterMs(response, body) {
    const header = response.headers.get("retry-after");
    let milliseconds;
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0)
            milliseconds = seconds * 1000;
        else {
            const date = Date.parse(header);
            if (Number.isFinite(date))
                milliseconds = Math.max(0, date - Date.now());
        }
    }
    const bodySeconds = body?.error?.retryAfterSeconds;
    if (milliseconds === undefined && typeof bodySeconds === "number" && bodySeconds >= 0) {
        milliseconds = bodySeconds * 1000;
    }
    // Retry-After is a server admission deadline, not exponential-backoff jitter.
    // Preserve it even when the caller disables retries (e.g. a bridge exposing
    // the deadline to the UI). The generic backoff cap applies only without it.
    return milliseconds;
}
async function boundedBody(response, signal) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
        throw new SendReputeError({ message: "SendRepute response was too large", code: "RESPONSE_TOO_LARGE", status: response.status });
    }
    if (!response.body)
        return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let output = "";
    while (true) {
        const { done, value } = await new Promise((resolve, reject) => {
            const aborted = () => {
                // Native fetch may already have errored the stream on abort. Consume
                // cancel's rejection; the request still rejects with the signal reason.
                void reader.cancel(signal.reason).catch(() => { });
                reject(signal.reason);
            };
            if (signal.aborted)
                return aborted();
            signal.addEventListener("abort", aborted, { once: true });
            void reader.read().then((result) => {
                signal.removeEventListener("abort", aborted);
                resolve(result);
            }, (error) => {
                signal.removeEventListener("abort", aborted);
                reject(error);
            });
        });
        if (done)
            break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new SendReputeError({ message: "SendRepute response was too large", code: "RESPONSE_TOO_LARGE", status: response.status });
        }
        output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
}
function parseJson(text) {
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        throw new SendReputeError({ message: "SendRepute returned an invalid JSON response", code: "INVALID_RESPONSE" });
    }
}
function apiError(response, body) {
    const payload = body;
    const rawCode = payload?.error?.code;
    const code = typeof rawCode === "string" && rawCode.length <= 128 ? rawCode : "API_ERROR";
    const rawRequestId = response.headers.get("x-request-id") ?? payload?.requestId;
    const requestId = typeof rawRequestId === "string" && rawRequestId.length <= 128 ? rawRequestId : undefined;
    const delay = retryAfterMs(response, body);
    return new SendReputeError({
        message: `SendRepute request failed with status ${response.status} (${code})`,
        code,
        status: response.status,
        ...(requestId ? { requestId } : {}),
        ...(delay !== undefined ? { retryAfterMs: delay } : {}),
    });
}
function retryable(operationId, error) {
    const safeOperation = RETRY_SAFE_OPERATIONS.has(operationId);
    const duplicateProtectedPost = operationId === "classifyCustomerEmail";
    if (!safeOperation)
        return false;
    if (error.status === undefined)
        return error.code === "NETWORK_ERROR";
    if (error.status === 409)
        return duplicateProtectedPost && error.code === "REQUEST_IN_PROGRESS";
    return error.status === 429 || error.status === 502 || error.status === 503;
}
function wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted)
            return reject(signal.reason);
        const aborted = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", aborted);
            resolve();
        }, milliseconds);
        signal.addEventListener("abort", aborted, { once: true });
    });
}
export class SendReputeClient {
    #apiKey;
    #baseUrl;
    #timeoutMs;
    #maxRetries;
    #fetch;
    constructor(options) {
        if (!options || typeof options !== "object")
            throw new TypeError("Client options are required");
        if (typeof options.apiKey !== "string" || !options.apiKey.trim())
            throw new TypeError("apiKey is required");
        if (/[\r\n]/.test(options.apiKey))
            throw new TypeError("apiKey is invalid");
        this.#apiKey = options.apiKey;
        this.#baseUrl = validatedBaseUrl(options.baseUrl);
        this.#timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", MAX_TIMEOUT_MS);
        if (this.#timeoutMs === 0)
            throw new TypeError("timeoutMs must be greater than zero");
        this.#maxRetries = positiveInteger(options.maxRetries ?? DEFAULT_MAX_RETRIES, "maxRetries", MAX_RETRIES);
        this.#fetch = options.fetch ?? globalThis.fetch;
        if (typeof this.#fetch !== "function")
            throw new TypeError("A fetch implementation is required");
    }
    async request(operationId, input = {}, options = {}) {
        const metadata = operationMetadata[operationId];
        if (!metadata)
            throw new TypeError(`Unknown operationId: ${String(operationId)}`);
        const value = (input ?? {});
        const url = requestUrl(this.#baseUrl, metadata.path, value);
        const body = value.body === undefined ? undefined : JSON.stringify(value.body);
        const deadline = AbortSignal.timeout(this.#timeoutMs);
        const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
        let attempt = 0;
        while (true) {
            try {
                const response = await this.#fetch(url, {
                    method: metadata.method,
                    headers: {
                        accept: "application/json",
                        authorization: `Bearer ${this.#apiKey}`,
                        ...(body === undefined ? {} : { "content-type": "application/json" }),
                    },
                    ...(body === undefined ? {} : { body }),
                    redirect: "manual",
                    signal,
                });
                if (response.status >= 300 && response.status < 400) {
                    throw new SendReputeError({
                        message: "SendRepute redirects are refused to protect credentials",
                        code: "REDIRECT_REFUSED",
                        status: response.status,
                    });
                }
                const parsed = parseJson(await boundedBody(response, signal));
                if (response.ok)
                    return parsed;
                throw apiError(response, parsed);
            }
            catch (cause) {
                if (signal.aborted) {
                    throw new SendReputeError({
                        message: options.signal?.aborted ? "SendRepute request was cancelled" : "SendRepute request timed out",
                        code: options.signal?.aborted ? "REQUEST_CANCELLED" : "REQUEST_TIMEOUT",
                        cause,
                    });
                }
                const error = cause instanceof SendReputeError
                    ? cause
                    : new SendReputeError({ message: "SendRepute network request failed", code: "NETWORK_ERROR", cause });
                if (attempt >= this.#maxRetries || !retryable(operationId, error))
                    throw error;
                attempt += 1;
                const delay = error.retryAfterMs ?? Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
                try {
                    await wait(delay, signal);
                }
                catch (waitCause) {
                    throw new SendReputeError({
                        message: options.signal?.aborted ? "SendRepute request was cancelled" : "SendRepute request timed out",
                        code: options.signal?.aborted ? "REQUEST_CANCELLED" : "REQUEST_TIMEOUT",
                        cause: waitCause,
                    });
                }
            }
        }
    }
}
export function decodeExportBytes(result) {
    if (!("archiveBase64" in result) || typeof result.archiveBase64 !== "string") {
        throw new TypeError("Export result does not contain base64 archive bytes");
    }
    const normalized = result.archiveBase64.replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
        throw new TypeError("Export result contains invalid base64");
    }
    return Uint8Array.from(Buffer.from(normalized, "base64"));
}
//# sourceMappingURL=index.js.map