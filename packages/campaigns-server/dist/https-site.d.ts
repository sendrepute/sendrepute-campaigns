type Mode = "automatic" | "uploaded" | "cloudflare-origin";
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
export declare function configureSite(input: {
    domain: unknown;
    mode: unknown;
    certificate?: unknown;
    privateKey?: unknown;
}): {
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
export {};
//# sourceMappingURL=https-site.d.ts.map