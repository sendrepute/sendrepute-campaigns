import { Router, type Request, type RequestHandler } from "express";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
type Db = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type Calendar = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
};
/**
 * Resolves a local calendar minute in an IANA zone. Ambiguous fall-back minutes
 * select the earlier instant; nonexistent spring-forward minutes return null.
 */
export declare function automationCalendarInstant(calendar: Calendar, timezone: string): Date | null;
export declare function automationAnnualDate(sourceDate: string, year: number, feb29Policy: "skip" | "feb28"): string | null;
export declare function automationTransaction<T>(db: Db, work: (tx: PoolClient) => Promise<T>): Promise<T>;
export declare function createAutomationsRouter(options: {
    db: Db;
    mutation: RequestHandler;
    need: (permission?: string) => RequestHandler;
    wrap: (handler: (req: Request, res: any) => Promise<void>) => RequestHandler;
    assertListsAllowed: (req: Request, ids: unknown) => void;
    restrictedLists: (req: Request) => string[] | null;
}): Router;
/**
 * Materializes due calendar occurrences as ordinary automation events. The
 * caller may supply `now` for a deterministic tick. Each tick is transactional;
 * event and occurrence uniqueness make retries harmless.
 */
export declare function scheduleDateAutomations(db: Db, now?: Date, limit?: number): Promise<number>;
/** Caller holds the delivery/restore advisory lock for the entire worker tick. */
export declare function advanceAutomations(db: Db, limit?: number): Promise<void>;
export {};
//# sourceMappingURL=automations.d.ts.map