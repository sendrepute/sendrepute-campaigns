import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
type Db = {
    query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type Bridge = {
    execute(operation: never, input: never): Promise<unknown>;
    getPaidResult?(id: string): Promise<unknown>;
    getPaidIdentity?(): Promise<{
        accountId: string;
        credentialId: string;
    }>;
    resolvePaidResult?(id: string, reason: string): Promise<unknown>;
};
export declare const paidDesignOperations: Set<string>;
export declare function paidDesignScope(secret: string): string;
/** No age cutoff: these records are durable entitlements, not a billing retry queue. */
export declare class PaidDesigns {
    private db;
    private bridge;
    private scope;
    private owner;
    private readPaid?;
    private compile;
    constructor(db: Db, bridge: Bridge, scope: string, owner: string, readPaid?: ((id: string) => Promise<unknown>) | undefined, compile?: (metadata: Json) => Promise<string>);
    private execute;
    purchase(operation: string, value: unknown): Promise<Json>;
    private save;
    /** Explicit, owner-scoped local repair. Never dispatch a paid or central request. */
    restoreSavedSource(id: string): Promise<"restored" | "already-present">;
    private repairPreviews;
    private reconcile;
    private verifyIdentity;
    private consumeSettlement;
    /** Operator authorization and audit are enforced by the route; no local override. */
    resolve(id: string, reason: string): Promise<void>;
    list(templateId?: string, operator?: boolean, cursor?: {
        createdAt: string;
        id: string;
    }): Promise<{
        items: Json[];
        nextCursor?: string;
    }>;
}
export {};
//# sourceMappingURL=paid-designs.d.ts.map