import { Router, type Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
type Json = Record<string, unknown>;
export type SubscriptionCustomizationDb = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};
export type SubscriptionPageContent = {
    subscribeTitle: string | null;
    subscribeMessage: string | null;
    pendingTitle: string | null;
    pendingMessage: string | null;
    confirmedTitle: string | null;
    confirmedMessage: string | null;
    unsubscribeTitle: string | null;
    unsubscribeMessage: string | null;
    goodbyeTitle: string | null;
    goodbyeMessage: string | null;
};
export type SubscriptionFormConfig = {
    showFirstName: boolean;
    showLastName: boolean;
    submitLabel: string | null;
};
export type SubscriptionMailConfig = {
    enabled: boolean;
    templateId: string | null;
    providerId: string | null;
};
export type SubscriptionCustomization = {
    listId: string;
    pageContent: SubscriptionPageContent;
    form: SubscriptionFormConfig;
    optInMode: "single" | "double" | null;
    welcome: SubscriptionMailConfig;
    goodbye: SubscriptionMailConfig;
};
export declare function getSubscriptionCustomization(db: SubscriptionCustomizationDb, listId: string): Promise<SubscriptionCustomization>;
export declare function resolveListDoubleOptIn(db: SubscriptionCustomizationDb, listId: string, installationDefault: boolean): Promise<boolean>;
export type SubscriptionCustomizationRouterDeps = {
    db: SubscriptionCustomizationDb;
    mutation: (request: Request, response: any, next: any) => void;
    need: (permission?: string) => any;
    wrap: (handler: (request: any, response: any) => Promise<void>) => any;
    assertListAllowed: (request: Request, listId: string) => Promise<void> | void;
    brandScope: () => Promise<string>;
    verifyListToken: (listId: string, token: string) => Promise<boolean> | boolean;
    audit: (request: Request, action: string, entityType: string, entityId: string | null, metadata?: Json) => Promise<void>;
    publicSubscribePath?: string;
    publicCustomizationPath?: (listId: string, token: string) => string;
};
export declare function createSubscriptionCustomizationRouter(deps: SubscriptionCustomizationRouterDeps): Router;
export type SubscriptionMailQueueEvent = {
    eventId: string;
    kind: "welcome" | "goodbye";
    listId: string;
    subscriberId: string;
    templateId: string;
    providerId: string;
};
type HookDeps = {
    db: SubscriptionCustomizationDb;
    enqueue: (event: SubscriptionMailQueueEvent) => Promise<void>;
};
type BaseHookEvent = {
    listId: string;
    subscriberId: string;
    consentEpoch: string;
};
export declare function onSubscribeConfirmed(deps: HookDeps, event: BaseHookEvent): Promise<boolean>;
export declare function onUnsubscribe(deps: HookDeps, event: BaseHookEvent & {
    reason: "user" | "complaint" | "hard_bounce" | "admin" | "provider";
    previousStatus: string;
}): Promise<boolean>;
export {};
//# sourceMappingURL=subscription-customization.d.ts.map