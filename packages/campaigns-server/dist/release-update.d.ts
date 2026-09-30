export declare const MANUAL_COOLDOWN_MS: number;
export declare function installedReleaseVersion(file?: string): string | null;
export type ReleaseUpdate = {
    currentVersion: string | null;
    latestVersion: string | null;
    status: "available" | "current" | "ahead" | "unavailable";
    reason: string | null;
    publishedAt: string | null;
    notes: string | null;
    releaseUrl: string | null;
    downloadUrl: string | null;
    checksumUrl: string | null;
};
export declare function interpretRelease(payload: unknown, currentVersion: string | null): ReleaseUpdate;
export declare class ManualCheckCooldownError extends Error {
    constructor();
}
export declare function checkRelease(currentVersion?: string | null, fetcher?: typeof fetch, now?: number, force?: boolean): Promise<ReleaseUpdate>;
//# sourceMappingURL=release-update.d.ts.map