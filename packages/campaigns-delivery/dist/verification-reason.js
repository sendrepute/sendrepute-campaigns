import { DeliveryError } from "./types.js";
/** Only locally observed, allowlisted facts are returned. Never forward an upstream body or exception text. */
export function verificationFailure(error) {
    if (!(error instanceof DeliveryError))
        return { errorCategory: "unavailable", reason: "Provider check could not be completed." };
    const status = error.statusCode;
    const providerHttpStatus = !error.code.includes("SMTP") && status && status >= 100 && status <= 599 ? status : undefined;
    const result = (errorCategory, reason) => ({ errorCategory, reason, ...(providerHttpStatus ? { providerHttpStatus } : {}) });
    if (error.code === "INVALID_CONFIG" || error.code === "TLS_REQUIRED")
        return result("configuration", "Provider configuration is incomplete or invalid.");
    if (error.code.endsWith("SMTP_AUTH_FAILED") || providerHttpStatus === 401)
        return result("authentication", "The provider rejected authentication credentials.");
    if (providerHttpStatus === 403)
        return result("permission", "The provider denied access to the non-sending check. Sending permission was not tested.");
    if (providerHttpStatus === 429)
        return result("rate_limited", "The provider rate limited the check. Try again later.");
    if (error.code === "HTTP_TIMEOUT" || error.code.endsWith("SMTP_TIMEOUT"))
        return result("timeout", "The provider check timed out.");
    if (error.code.endsWith("DNS_FAILED") || error.code === "HTTP_DNS")
        return result("dns", "The provider hostname could not be resolved.");
    if (error.code.endsWith("TLS_FAILED") || error.code === "HTTP_TLS")
        return result("tls", "The provider TLS connection could not be verified.");
    if (error.code === "HTTP_TRANSPORT" || error.code.endsWith("SMTP_NETWORK"))
        return result("network", "A network connection to the provider could not be established.");
    if (error.code === "HTTP_REDIRECT" || providerHttpStatus === 404)
        return result("endpoint", "The provider check endpoint was unavailable or returned HTTP 404.");
    if (providerHttpStatus === 502 || providerHttpStatus === 503 || providerHttpStatus === 504)
        return result("unavailable", "The provider service is temporarily unavailable.");
    if (providerHttpStatus)
        return result("provider", `The provider returned HTTP ${providerHttpStatus} to the non-sending check.`);
    return result("unavailable", "Provider check could not be completed.");
}
//# sourceMappingURL=verification-reason.js.map