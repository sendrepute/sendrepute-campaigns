import { Router, type Request } from "express";
import { type HousekeepingDb } from "./housekeeping.js";
import { type HygieneCheck } from "./email-hygiene.js";
type Json = Record<string, any>;
export type HygieneDependencies = {
    db: HousekeepingDb;
    mutation: any;
    need: (permission: string) => any;
    wrap: (handler: (request: Request, response: any) => Promise<void>) => any;
    page: (request: Request) => {
        page: number;
        pageSize: number;
        offset: number;
    };
    scope: () => Promise<string>;
    restrictedLists: (request: Request) => string[] | null;
    assertListsAllowed: (request: Request, listIds: unknown) => void;
    assertSubscriberIdsAllowed: (request: Request, ids: string[], db?: HousekeepingDb) => Promise<void>;
    refreshListCounts: (db: HousekeepingDb) => Promise<void>;
    http: (status: number, message: string) => Error;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
};
export declare function createEmailHygieneRouter(deps: HygieneDependencies): Router;
/**
 * Small, resumable, read-only contact scan. One locked batch per worker tick,
 * no dependency on an open browser. Crash/rollback replays the same cursor.
 * DNS concurrency is four and cached only inside this batch.
 */
export declare function advanceEmailHygiene(db: HousekeepingDb, domainCheck?: (domain: string) => Promise<HygieneCheck>): Promise<void>;
export {};
//# sourceMappingURL=email-hygiene-operations.d.ts.map