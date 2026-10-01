import type { DomainsTrackingDb } from "./domains-tracking.js";
type Mode = "automatic" | "uploaded" | "cloudflare-origin";
type Site = {
    domain: string;
    mode: Mode;
    revision: string;
    expiresAt?: string;
    certificateRevision?: string;
    trackingHosts?: TrackingHost[];
};
type TrackingHost = {
    hostname: string;
    basePath: string;
};
export type TrackingProxyState = "unverified" | "pending" | "loaded" | "error" | "operator-required";
export declare function validSiteDomain(value: unknown): string;
export declare function validateSite(input: {
    domain: unknown;
    mode: unknown;
    certificate?: unknown;
    privateKey?: unknown;
}): {
    domain: string;
    mode: "automatic";
    certificate?: undefined;
    privateKey?: undefined;
    expiresAt?: undefined;
} | {
    domain: string;
    mode: "uploaded" | "cloudflare-origin";
    certificate: string;
    privateKey: string;
    expiresAt: string;
};
export declare function siteStatus(): {
    available: boolean;
    state: string;
    message: string;
    domain?: undefined;
    mode?: undefined;
    expiresAt?: undefined;
} | {
    available: boolean;
    state: string;
    domain: string | undefined;
    mode: Mode | undefined;
    expiresAt: string | undefined;
    message: string;
};
/** Explicit verified names only; never use wildcard or unbounded on-demand TLS. */
export declare function renderSiteCaddyfile(site: Site, hosts: TrackingHost[], certificate?: string): string;
export declare function configureSite(input: {
    domain: unknown;
    mode: unknown;
    certificate?: unknown;
    privateKey?: unknown;
}): Promise<{
    available: boolean;
    state: string;
    message: string;
    domain?: undefined;
    mode?: undefined;
    expiresAt?: undefined;
} | {
    available: boolean;
    state: string;
    domain: string | undefined;
    mode: Mode | undefined;
    expiresAt: string | undefined;
    message: string;
}>;
/** Reconciliation is retryable after DNS/DB success but filesystem failure. */
export declare function reconcileTrackingHttps(db: DomainsTrackingDb, retryRejected?: boolean): Promise<void>;
/** Startup can continue serving its last-good site on storage errors. The
 * explicit error remains visible in domain status until a retry succeeds. */
export declare function synchronizeTrackingHttps(db: DomainsTrackingDb, retryRejected?: boolean): Promise<boolean>;
export declare function trackingHttpsStatus(hostname: string, basePath: string, verified: boolean, failure?: boolean): {
    required: boolean;
    configuredByApplication: boolean;
    proxyState: TrackingProxyState;
    certificateState: "not-checked";
    certificateSource: "automatic" | "operator-required" | "not-configured" | "primary-uploaded" | "primary-cloudflare-origin";
    proxyError: string | null;
};
export {};
//# sourceMappingURL=https-site.d.ts.map