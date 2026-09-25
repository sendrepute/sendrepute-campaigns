import { Router, type Request } from "express";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
export type HousekeepingDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    connect?: () => Promise<PoolClient>;
};
type Deps = {
    db: HousekeepingDb;
    secret: Buffer;
    now: () => Date;
    mutation: (request: Request, response: any, next: any) => void;
    need: (permission?: string) => any;
    wrap: (handler: (request: Request, response: any) => Promise<void>) => any;
    page: (request: Request) => {
        page: number;
        pageSize: number;
        offset: number;
    };
    json: (value: unknown) => Json;
    fields: (body: Json, allowed: readonly string[], required?: readonly string[]) => void;
    http: (status: number, message: string) => Error;
    scope: () => Promise<string>;
    assertSubscriberIdsAllowed: (request: Request, ids: string[], db?: HousekeepingDb) => Promise<void>;
    refreshListCounts: (db?: HousekeepingDb) => Promise<void>;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
};
export declare function cancelQueuedSubscriberJobs(db: HousekeepingDb, subscriberIds: readonly string[], actorId: string, reason: string): Promise<number>;
export declare function createHousekeepingRouter(deps: Deps): Router;
export {};
//# sourceMappingURL=housekeeping.d.ts.map