export type ReadinessCheck = {
    key: "smtp" | "address" | "spf" | "dmarc" | "ptr" | "dkim";
    status: "pass" | "needs-fix" | "inconclusive";
    detail: string;
    repair: string;
};
export type ReadinessResolver = {
    resolveTxt(host: string): Promise<string[][]>;
    resolveAddresses(host: string): Promise<string[]>;
    reverse(ip: string): Promise<string[]>;
};
export declare const readinessResolver: ReadinessResolver;
export declare function inspectPrivateSmtp(input: {
    domain: string;
    outboundIp?: string;
    dkimSelector?: string;
}, resolver?: ReadinessResolver): Promise<ReadinessCheck[]>;
//# sourceMappingURL=private-smtp-readiness.d.ts.map