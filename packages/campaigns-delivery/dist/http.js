import { DeliveryError } from "./types.js";
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RESPONSE = 1_048_576;
export async function boundedFetch(url, init, options, operation) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new DeliveryError("No fetch implementation is available", "FETCH_UNAVAILABLE", "not-sent");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
        throw new DeliveryError("timeoutMs must be between 1 and 120000", "INVALID_OPTIONS", "not-sent");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetchImpl(url, { ...init, redirect: "manual", signal: controller.signal });
    }
    catch (error) {
        const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : "failed";
        clearTimeout(timeout);
        throw new DeliveryError(`Provider request ${detail}`, detail === "timed out" ? "HTTP_TIMEOUT" : "HTTP_TRANSPORT", operation === "send" ? "unknown" : "not-sent");
    }
    if (response.status >= 300 && response.status < 400) {
        clearTimeout(timeout);
        throw new DeliveryError("Provider redirects are not allowed", "HTTP_REDIRECT", operation === "send" ? "unknown" : "not-sent", response.status);
    }
    const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_485_760) {
        clearTimeout(timeout);
        throw new DeliveryError("maxResponseBytes must be between 1 and 10485760", "INVALID_OPTIONS", "not-sent");
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        clearTimeout(timeout);
        throw new DeliveryError("Provider response exceeded the byte limit", "RESPONSE_TOO_LARGE", operation === "send" ? "unknown" : "not-sent", response.status);
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                total += value.byteLength;
                if (total > maxBytes) {
                    await reader.cancel();
                    throw new DeliveryError("Provider response exceeded the byte limit", "RESPONSE_TOO_LARGE", operation === "send" ? "unknown" : "not-sent", response.status);
                }
                chunks.push(value);
            }
        }
        catch (error) {
            clearTimeout(timeout);
            if (error instanceof DeliveryError)
                throw error;
            throw new DeliveryError(controller.signal.aborted ? "Provider response timed out" : "Provider response could not be read", controller.signal.aborted ? "HTTP_TIMEOUT" : "HTTP_TRANSPORT", operation === "send" ? "unknown" : "not-sent", response.status);
        }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    let json = undefined;
    if (text) {
        try {
            json = JSON.parse(text);
        }
        catch { /* caller can use bounded text */ }
    }
    clearTimeout(timeout);
    return { status: response.status, ok: response.ok, json, text, header: (name) => response.headers.get(name) };
}
export function safeProviderError(status, _body) {
    // Provider bodies are deliberately excluded: some vendors echo request or
    // credential fragments in diagnostics.
    return `Provider rejected the request (HTTP ${status})`;
}
export function httpFailureState(status) {
    return status >= 400 && status < 500 ? "rejected" : "unknown";
}
/** A provider's explicit throttle proves non-acceptance and is safe to retry. */
export function httpFailure(status) {
    if (status === 429)
        return { state: "not-sent", retryable: true };
    if (status >= 400 && status < 500 && status !== 408)
        return { state: "rejected", retryable: false };
    return { state: "unknown", retryable: false };
}
//# sourceMappingURL=http.js.map