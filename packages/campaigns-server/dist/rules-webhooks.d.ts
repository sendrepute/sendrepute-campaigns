import { Router, type Request, type RequestHandler } from "express";
import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
export type RulesDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
export type RuleEventType = "campaign.scheduled" | "campaign.sending" | "campaign.sent" | "automation.sent" | "list.joined";
export interface RuleEvent {
    eventId: string;
    type: RuleEventType;
    campaignId?: string;
    campaignName?: string;
    automationId?: string;
    subscriberId?: string;
    listId?: string;
    listIds?: string[];
    occurredAt?: string;
}
export interface PinnedWebhookRequest {
    address: string;
    servername: string;
    body: string;
    headers: Readonly<Record<string, string>>;
    timeoutMs: number;
    maxResponseBytes: number;
}
export type WebhookTransport = (url: string, request: PinnedWebhookRequest) => Promise<{
    status: number;
}>;
export type DnsResolver = (hostname: string) => Promise<readonly string[]>;
export type QueueRuleEmail = (message: {
    idempotencyKey: string;
    to: string;
    subject: string;
    text: string;
}) => Promise<void>;
export interface RulesRouterDeps {
    db: RulesDb;
    mutation: RequestHandler;
    need: (permission?: string) => RequestHandler;
    wrap: (handler: (request: Request, response: any) => Promise<void>) => RequestHandler;
    assertListsAllowed: (request: Request, ids: unknown) => void;
    restrictedLists: (request: Request) => string[] | null;
    key: Buffer;
    encrypt: (key: Buffer, value: string) => string;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
}
export declare function createRulesWebhooksRouter(deps: RulesRouterDeps): Router;
/** Call with the transaction client that durably records the source event. */
export declare function recordRuleEvent(db: RulesDb, event: RuleEvent): Promise<number>;
export declare function deliverSignedWebhook(options: {
    url: string;
    secret: string;
    payload: Json;
    deliveryId: string;
    resolver?: DnsResolver;
    transport?: WebhookTransport;
}): Promise<void>;
export declare function runRulesWebhookWorker(options: {
    db: RulesDb;
    key: Buffer;
    decrypt: (key: Buffer, value: string) => string;
    enqueueEmail: QueueRuleEmail;
    authorizeListAction: (ruleId: string, targetListId: string) => boolean | Promise<boolean>;
    resolver?: DnsResolver;
    transport?: WebhookTransport;
    batchSize?: number;
}): Promise<{
    claimed: number;
    delivered: number;
    retried: number;
    failed: number;
}>;
export {};
//# sourceMappingURL=rules-webhooks.d.ts.map