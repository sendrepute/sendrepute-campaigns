import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
import { type DeliveryOptions, type ProviderAnalyticsEvent, type ProviderAnalyticsSyncRequest, type ProviderAnalyticsSyncResult, type ProviderConfig } from "@workspace/campaigns-delivery";
export type ProviderAnalyticsDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type Json = Record<string, unknown>;
type AnalyticsSync = (config: ProviderConfig, request?: ProviderAnalyticsSyncRequest, options?: DeliveryOptions) => Promise<ProviderAnalyticsSyncResult>;
export interface ProviderAnalyticsRouterDeps {
    db: ProviderAnalyticsDb;
    decrypt: (key: Buffer, encrypted: string) => string;
    credentialKey: Buffer;
    mutation: (request: Request, response: unknown, next: unknown) => void;
    need: (permission?: string) => unknown;
    wrap: (handler: (request: any, response: any) => Promise<void>) => unknown;
    page: (request: Request) => {
        page: number;
        pageSize: number;
        offset: number;
    };
    restrictedLists: (request: Request) => string[] | null;
    http: (status: number, message: string, code?: string) => Error;
    audit?: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
    sync?: AnalyticsSync;
    deliveryOptions?: DeliveryOptions;
}
/** Converts the existing public provider body plus its decrypted-at-runtime secret. */
export declare function providerAnalyticsConfig(provider: Json, decryptedSecret: string): ProviderConfig;
export interface ProviderAnalyticsIngestResult {
    imported: number;
    duplicate: number;
    campaignIds: string[];
}
/** Shared by polling and existing authenticated webhook handlers. */
export declare function ingestProviderAnalyticsEvents(db: ProviderAnalyticsDb, providerId: string, events: readonly ProviderAnalyticsEvent[], source: "poll" | "webhook"): Promise<ProviderAnalyticsIngestResult>;
export declare function ingestProviderAnalyticsWebhook(db: ProviderAnalyticsDb, providerId: string, providerType: ProviderConfig["type"], authenticatedPayload: unknown): Promise<ProviderAnalyticsIngestResult>;
export declare function createProviderAnalyticsRouter(deps: ProviderAnalyticsRouterDeps): Router;
export {};
//# sourceMappingURL=provider-analytics.d.ts.map