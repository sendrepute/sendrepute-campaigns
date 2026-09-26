import { Router } from "express";
import { type QueryResult, type QueryResultRow } from "pg";
import { SendReputeClient } from "@workspace/campaigns-bridge";
import { sendMessage, verifyProvider } from "@workspace/campaigns-delivery";
import { type TelegramSend } from "./telegram-notifications.js";
import { type AudienceRepository, type AudienceSource, type AudienceSnapshot } from "./audience.js";
export * from "./delivery-contract.generated.js";
export { enqueueCampaignNotification, runTelegramNotificationWorker, sendTelegramMessage, } from "./telegram-notifications.js";
type Json = Record<string, unknown>;
type Db = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
/** Independent of delivery/activation: an idle installation must still erase expired payloads. */
export declare function cleanupCampaignInsightRetention(db: Db, now?: Date): Promise<void>;
type Bridge = {
    getPaidResult?(id: string): Promise<unknown>;
    campaignInsightsQuote?: SendReputeClient["campaignInsightsQuote"];
    campaignInsightsAnalyze?: SendReputeClient["campaignInsightsAnalyze"];
    validateActivation(): Promise<unknown>;
    getConnectionSnapshot(): Promise<unknown>;
    execute(operation: never, input: never): Promise<unknown>;
    createHostedBuilderHandoff?(input: {
        state: string;
        returnOrigin: string;
        initialMjml?: string;
        mode?: "standard" | "vip";
        vipAccessId?: string;
        initialDocument?: Json;
    }): Promise<unknown>;
};
export interface CampaignsRouterOptions {
    databaseUrl?: string;
    pool?: Db;
    dataDir?: string;
    secureCookies?: boolean;
    trustProxy?: boolean;
    sessionHours?: number;
    activationRevalidateMs?: number;
    bridgeFactory?: (apiKey: string) => Bridge;
    send?: typeof sendMessage;
    verify?: typeof verifyProvider;
    verifySesWebhookSignature?: (message: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
    telegramSend?: TelegramSend;
    now?: () => Date;
}
/**
 * Keep a self-hosted Campaigns installation in its own PostgreSQL database
 * without copying credentials into another environment variable.
 */
export declare function campaignsDatabaseUrl(environment?: NodeJS.ProcessEnv): string | undefined;
export declare function populateUnsubscribeContent(html: string, text: string, unsubscribeUrl: string): {
    html: string;
    text: string;
};
export declare function publicSubscriptionUrl(publicUrl: string, listId: string, listToken: string): string;
export declare function publicCampaignsPageUrl(publicUrl: string, page: "subscribe" | "unsubscribe"): URL;
declare global {
    namespace Express {
        interface Request {
            user?: Json & {
                id: string;
                name: string;
                email: string;
                roleIds: string[];
                permissions: string[];
            };
            csrf?: string;
            csrfToken?: string;
        }
    }
}
declare global {
    namespace Express {
        interface Request {
            user?: Json & {
                id: string;
                name: string;
                email: string;
                roleIds: string[];
                permissions: string[];
            };
            csrf?: string;
            csrfToken?: string;
        }
    }
}
export declare function resolveCampaignAudience(repository: AudienceRepository, scope: string, source: AudienceSource & {
    excludeListIds?: string[];
    excludeSegmentIds?: string[];
}, allowedListIds: readonly string[] | null, generatedAt?: string): Promise<AudienceSnapshot & {
    source: {
        listIds: string[];
        segmentIds: string[];
        excludeListIds: string[];
        excludeSegmentIds: string[];
    };
}>;
export declare function createCampaignsRouter(options?: CampaignsRouterOptions): Router;
export interface CampaignsWorkerOptions extends CampaignsRouterOptions {
    batchSize?: number;
    staleSendingMinutes?: number;
}
export interface CampaignsWorkerSchedulerOptions extends CampaignsWorkerOptions {
    intervalMs?: number;
    onError?: (error: unknown) => void;
}
export interface CampaignsWorkerScheduler {
    stop(): Promise<void>;
}
export declare function startCampaignsWorker(options?: CampaignsWorkerSchedulerOptions): CampaignsWorkerScheduler;
export declare function runCampaignsWorker(options?: CampaignsWorkerOptions): Promise<{
    claimed: number;
    sent: number;
    rejected: number;
    unknown: number;
}>;
//# sourceMappingURL=index.d.ts.map