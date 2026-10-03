import type { HousekeepingDb } from "./housekeeping.js";
export declare const DISPOSABLE_SOURCE_URL = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
export declare const MAILCHECKER_SOURCE_URL = "https://raw.githubusercontent.com/FGRibreau/mailchecker/master/list.txt";
export declare function parseDisposableList(text: string): Set<string>;
export declare const primaryDisposableDomains: Set<string>;
export declare const mailcheckerDisposableDomains: Set<string>;
export declare const bundledDisposableDomains: Set<string>;
export declare function matchesDisposableDomain(domain: string, domains: ReadonlySet<string>): boolean;
export type DisposableSourceStatus = {
    sourceUrl: string;
    domainCount: number;
    checkedAt: string | null;
    updatedAt: string | null;
    lastError: string | null;
    bundled: boolean;
    nextCheckAt: string | null;
};
export declare function disposableSource(db: HousekeepingDb): DisposableSource;
export declare class DisposableSource {
    private fetcher;
    domains: ReadonlySet<string>;
    private primary;
    private secondary;
    private previousPrimary?;
    private previousSecondary?;
    constructor(db: HousekeepingDb, fetcher?: typeof fetch);
    load(force?: boolean): Promise<void>;
    status(): Promise<DisposableSourceStatus>;
    refresh(manual?: boolean): Promise<DisposableSourceStatus>;
}
//# sourceMappingURL=disposable-source.d.ts.map