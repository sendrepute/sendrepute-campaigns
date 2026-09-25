import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
export type DomainsTrackingDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
export type DnsVerifier = {
    resolveTxt(hostname: string): Promise<string[][]>;
    resolveAddresses(hostname: string): Promise<string[]>;
};
export type TrackingEvent = {
    documentId: string;
    jobId: string | null;
    campaignId: string | null;
    recipientId: string | null;
    type: "open" | "click";
    key: string;
    occurredAt: Date;
};
export type TrackingEventRecorder = (event: TrackingEvent) => Promise<boolean>;
export declare function normalizeCustomDomain(value: unknown): string;
export declare function normalizeBasePath(value: unknown): string;
export declare function verificationRecordName(hostname: string): string;
export declare function verificationRecordValue(challenge: string): string;
export declare const systemDnsVerifier: DnsVerifier;
export declare function verifyDomainChallenge(hostnameValue: string, challenge: string, resolver?: DnsVerifier): Promise<void>;
export declare function sanitizeWebVersionHtml(value: string): string;
export declare function validateStoredDestination(value: unknown): string;
export type CreateTrackingLinksInput = {
    signingKey: Buffer | string;
    installationPublicUrl: string;
    domainId?: string | null;
    jobId?: string | null;
    campaignId?: string | null;
    recipientId?: string | null;
    subject: string;
    html: string;
    text?: string | null;
    trackingEnabled: boolean;
    recipientTrackingOptOut: boolean;
    clicks?: Array<{
        key?: string;
        url: string;
    }>;
    expiresAt?: Date | null;
};
export declare function createCampaignTrackingLinks(db: DomainsTrackingDb, input: CreateTrackingLinksInput): Promise<{
    documentId: string;
    webVersionUrl: string;
    openUrl: string | null;
    clicks: Array<{
        key: string;
        destination: string;
        url: string;
    }>;
}>;
export declare function createPostgresTrackingEventRecorder(db: DomainsTrackingDb, onUniqueEvent: (event: TrackingEvent) => Promise<void>): TrackingEventRecorder;
type RouterDeps = {
    db: DomainsTrackingDb;
    signingKey: Buffer | string;
    dns?: DnsVerifier;
    now?: () => Date;
    recordEvent: TrackingEventRecorder;
    need: (permission: string) => any;
    mutation: any;
    wrap: (handler: (request: Request, response: any) => Promise<void>) => any;
    page: (request: Request) => {
        page: number;
        pageSize: number;
        offset: number;
    };
    http?: (status: number, message: string) => Error;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Record<string, unknown>) => Promise<void>;
};
export declare function createDomainsTrackingRouter(deps: RouterDeps): Router;
export {};
//# sourceMappingURL=domains-tracking.d.ts.map