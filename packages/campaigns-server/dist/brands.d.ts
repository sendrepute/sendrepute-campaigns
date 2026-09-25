import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
export type BrandDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type Deps = {
    db: BrandDb;
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
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
};
export declare function getBrandDefaults(db: BrandDb, scope: string, brandId: unknown): Promise<Json | null>;
export declare function createBrandsRouter(deps: Deps): Router;
export {};
//# sourceMappingURL=brands.d.ts.map