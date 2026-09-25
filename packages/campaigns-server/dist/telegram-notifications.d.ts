import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
export type NotificationDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
export type TelegramEventType = "started" | "completed" | "failed" | "opened" | "clicked";
export type TelegramSend = (botToken: string, chatId: string, text: string) => Promise<void>;
export declare function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void>;
type RouterDeps = {
    db: NotificationDb;
    key: Buffer;
    encrypt: (key: Buffer, value: string) => string;
    decrypt: (key: Buffer, value: string) => string;
    sender: TelegramSend;
    mutation: (request: Request, response: any, next: any) => void;
    need: (permission?: string) => any;
    wrap: (handler: (request: any, response: any) => Promise<void>) => any;
    json: (value: unknown) => Json;
    fields: (body: Json, allowed: readonly string[], required?: readonly string[]) => void;
    http: (status: number, message: string) => Error;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
};
export declare function createTelegramNotificationsRouter(deps: RouterDeps): Router;
export declare function enqueueCampaignNotification(db: NotificationDb, event: {
    campaignId: string;
    type: TelegramEventType;
    dedupeKey: string;
    campaignName: string;
    text: string;
}): Promise<boolean>;
export declare function runTelegramNotificationWorker(options: {
    db: NotificationDb;
    key: Buffer;
    decrypt: (key: Buffer, value: string) => string;
    sender?: TelegramSend;
    batchSize?: number;
}): Promise<{
    claimed: number;
    delivered: number;
    retried: number;
    failed: number;
}>;
export {};
//# sourceMappingURL=telegram-notifications.d.ts.map