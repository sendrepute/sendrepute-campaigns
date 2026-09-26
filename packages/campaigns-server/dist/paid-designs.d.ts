import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
type Db = {
    query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type Bridge = {
    execute(operation: never, input: never): Promise<unknown>;
    getPaidResult?(id: string): Promise<unknown>;
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
    private repairPreviews;
    private reconcile;
    list(templateId?: string): Promise<{
        items: Json[];
    }>;
}
export {};
//# sourceMappingURL=paid-designs.d.ts.map