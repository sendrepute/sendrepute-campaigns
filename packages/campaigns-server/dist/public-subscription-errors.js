/** Public subscription endpoints must not reveal delivery, database or queue internals. */
export function publicSubscriptionFailure(status, path) {
    if (status >= 500)
        return { error: "Service temporarily unavailable. Please try again later.", code: "SERVICE_UNAVAILABLE" };
    if (status === 429)
        return { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" };
    if (status === 400 || status === 404) {
        return { error: path === "/public/subscribe" ? "Invalid signup request or link." : "Invalid or expired link.", code: "INVALID_LINK" };
    }
    return { error: "The request could not be completed.", code: "REQUEST_FAILED" };
}
//# sourceMappingURL=public-subscription-errors.js.map