import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
export { systemDnsVerifier } from "./domain-dns.js";
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
/** Factory injection keeps lifecycle tests independent of process-wide DNS state. */
export declare function createDomainChallengeVerifier(createDnsVerifier?: () => DnsVerifier): (hostnameValue: string, challenge: string, injectedResolver?: DnsVerifier) => Promise<void>;
export declare const verifyDomainChallenge: (hostnameValue: string, challenge: string, injectedResolver?: DnsVerifier) => Promise<void>;
export declare function sanitizeWebVersionHtml(value: string): string;
export declare function validateStoredDestination(value: unknown): string;
/** Collect only eligible anchors; position-specific replacement never alters text, image URLs or other attributes. */
export declare function campaignClickDestinations(html: string, excluded?: string[]): string[];
export declare function rewriteCampaignClickAnchors(html: string, destinations: string[], links: string[]): string;
export declare function selectBaseUrl(db: DomainsTrackingDb, installationPublicUrl: string, domainId?: string | null): Promise<URL>;
/** List metadata is portable with existing list backups. Never trust an arbitrary URL. */
export declare function listPublicDomain(db: DomainsTrackingDb, installationPublicUrl: string, listId?: string): Promise<{
    baseUrl: string;
    domainId: string | null;
}>;
export declare function recipientPublicList(subscriberLists: unknown, campaignLists: unknown): string | undefined;
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
    openTrackingEnabled?: boolean;
    clickTrackingEnabled?: boolean;
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
export declare function createPostgresTrackingEventRecorder(db: DomainsTrackingDb, onUniqueEvent: (event: TrackingEvent, client: DomainsTrackingDb) => Promise<void>): TrackingEventRecorder;
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
/** Mount at the HTTP root, ahead of static assets, without exposing management routes. */
export declare function createPublicCampaignsTrackingRouter(deps: Pick<RouterDeps, "db" | "signingKey" | "now" | "recordEvent" | "wrap" | "http">): Router;
//# sourceMappingURL=domains-tracking.d.ts.map