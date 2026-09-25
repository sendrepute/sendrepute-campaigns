import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
export type Json = Record<string, unknown>;
export type DeliveryDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
export type DeliveryEventType = "worker_attempt" | "accepted" | "rejected" | "unknown" | "retry_scheduled" | "cancelled" | "provider_delivered" | "provider_opened" | "provider_clicked" | "provider_bounced" | "provider_soft_bounced" | "provider_complained" | "provider_unsubscribed" | "reconciled_accepted" | "reconciled_rejected" | "explicit_retry";
export declare function appendDeliveryEvent(db: DeliveryDb, event: {
    jobId: string;
    campaignId?: string | null;
    recipientId?: string | null;
    type: DeliveryEventType;
    source: "worker" | "provider" | "operator" | "system";
    attempt?: number | null;
    providerMessageId?: string | null;
    providerEventKey?: string | null;
    errorCode?: string | null;
    metadata?: Json;
    actorId?: string | null;
    occurredAt?: Date;
}): Promise<boolean>;
export declare function refreshCampaignDeliveryStatistics(db: DeliveryDb, campaignId: string): Promise<void>;
type RouteDeps = {
    db: DeliveryDb;
    mutation: (request: Request, response: any, next: any) => void;
    need: (permission?: string) => any;
    wrap: (handler: (request: any, response: any) => Promise<void>) => any;
    json: (value: unknown) => Json;
    fields: (body: Json, allowed: readonly string[], required?: readonly string[]) => void;
    page: (request: Request) => {
        page: number;
        pageSize: number;
        offset: number;
    };
    http: (status: number, message: string, code?: string) => Error;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
    assertCampaignAllowed: (request: Request, campaignId: string) => Promise<void>;
};
export declare function createDeliveryReliabilityRouter(deps: RouteDeps): Router;
export {};
//# sourceMappingURL=delivery-reliability.d.ts.map