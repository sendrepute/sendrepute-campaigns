import { type OperationId, type OperationInput, type OperationResponse, type PricingSettings } from "@sendrepute/node";
import { type InsightMetrics, type InsightQuote, type InsightResult } from "./campaign-insights.js";
export * from "./campaign-insights.js";
export type CustomerApiScope = "classify" | "models:read" | "usage:read" | "account:read" | "billing:read" | "billing:write" | "catalog:read" | "vip:read" | "vip:purchase" | "rewrite" | "ai:generate" | "builder:read" | "builder:write" | "vip:builder";
/**
 * Hosted handoffs are intentionally unavailable through the generic executor:
 * their return origin must remain controlled by the trusted server integration.
 */
export type GenericOperationId = Exclude<OperationId, "customerCreateHostedBuilderHandoff" | "customerQuoteCampaignInsights" | "customerAnalyzeCampaignInsights">;
export declare const PRODUCTION_API_BASE_URL: "https://www.sendrepute.com/api/";
export declare const PRODUCTION_HOSTED_BUILDER_ORIGIN: string;
export declare const MAX_BRIDGE_REQUEST_BYTES: number;
export declare const MAX_BRIDGE_RESPONSE_BYTES: number;
export declare const DEFAULT_AI_REWRITE_TIMEOUT_MS = 540000;
export declare const DEFAULT_AI_GENERATION_TIMEOUT_MS = 120000;
export declare const operationCapabilities: {
    readonly getCustomerApiModels: {
        readonly method: "GET";
        readonly path: "/v1/models";
        readonly scope: "models:read";
        readonly billable: false;
    };
    readonly getCustomerApiUsage: {
        readonly method: "GET";
        readonly path: "/v1/usage";
        readonly scope: "usage:read";
        readonly billable: false;
    };
    readonly classifyCustomerEmail: {
        readonly method: "POST";
        readonly path: "/v1/classify";
        readonly scope: "classify";
        readonly billable: true;
        readonly consent: "priceAuthorization";
    };
    readonly customerGetAccount: {
        readonly method: "GET";
        readonly path: "/v1/account";
        readonly scope: "account:read";
        readonly billable: false;
    };
    readonly customerGetAccountReferrals: {
        readonly method: "GET";
        readonly path: "/v1/account/referrals";
        readonly scope: "account:read";
        readonly billable: false;
    };
    readonly customerGetCreditLedger: {
        readonly method: "GET";
        readonly path: "/v1/account/ledger";
        readonly scope: "billing:read";
        readonly billable: false;
    };
    readonly customerListPaymentInvoices: {
        readonly method: "GET";
        readonly path: "/v1/payments/invoices";
        readonly scope: "billing:read";
        readonly billable: false;
    };
    readonly customerCreatePaymentInvoice: {
        readonly method: "POST";
        readonly path: "/v1/payments/invoices";
        readonly scope: "billing:write";
        readonly billable: false;
    };
    readonly customerDeletePaymentInvoice: {
        readonly method: "DELETE";
        readonly path: "/v1/payments/invoices/{invoiceId}";
        readonly scope: "billing:write";
        readonly billable: false;
    };
    readonly customerListPaymentMethods: {
        readonly method: "GET";
        readonly path: "/v1/payments/methods";
        readonly scope: "billing:read";
        readonly billable: false;
    };
    readonly customerGetActiveDepositOffer: {
        readonly method: "GET";
        readonly path: "/v1/payments/deposit-offer";
        readonly scope: "billing:read";
        readonly billable: false;
    };
    readonly customerRefreshMyPayments: {
        readonly method: "POST";
        readonly path: "/v1/payments/refresh";
        readonly scope: "billing:write";
        readonly billable: false;
    };
    readonly customerGetPricingSettings: {
        readonly method: "GET";
        readonly path: "/v1/pricing";
        readonly scope: "catalog:read";
        readonly billable: false;
    };
    readonly customerGetVipPlans: {
        readonly method: "GET";
        readonly path: "/v1/vip/plans";
        readonly scope: "catalog:read";
        readonly billable: false;
    };
    readonly customerGetVip: {
        readonly method: "GET";
        readonly path: "/v1/vip";
        readonly scope: "vip:read";
        readonly billable: false;
    };
    readonly customerPurchaseVip: {
        readonly method: "POST";
        readonly path: "/v1/vip/purchase";
        readonly scope: "vip:purchase";
        readonly billable: true;
        readonly consent: "expectedPrice";
    };
    readonly customerQuoteClassificationEdit: {
        readonly method: "POST";
        readonly path: "/v1/rewrite/quote";
        readonly scope: "rewrite";
        readonly billable: false;
        readonly deprecated: true;
    };
    readonly customerQuoteManualClassificationEdit: {
        readonly method: "POST";
        readonly path: "/v1/classify/edit/quote";
        readonly scope: "classify";
        readonly billable: false;
    };
    readonly customerClassifyEmail: {
        readonly method: "POST";
        readonly path: "/v1/classify/edit";
        readonly scope: "classify";
        readonly billable: true;
        readonly consent: "editQuote";
    };
    readonly customerRewriteFlaggedTermsWithAi: {
        readonly method: "POST";
        readonly path: "/v1/rewrite";
        readonly scope: "rewrite";
        readonly billable: true;
        readonly consent: "rewriteQuote";
    };
    readonly customerQuoteAiRewrite: {
        readonly method: "POST";
        readonly path: "/v1/rewrite/ai-quote";
        readonly scope: "rewrite";
        readonly billable: false;
    };
    readonly customerCreateAiEmailTemplate: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/ai-template";
        readonly scope: "ai:generate";
        readonly billable: true;
        readonly consent: "expectedPrice";
    };
    readonly customerGetPaidResult: {
        readonly method: "GET";
        readonly path: "/customer/paid-results/{recoveryId}";
        readonly scope: "builder:read";
        readonly billable: false;
    };
    readonly customerCreateVipEmailTemplate: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-template";
        readonly scope: "ai:generate";
        readonly billable: true;
        readonly consent: "expectedPrice";
    };
    readonly customerAccessEmailBuilder: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/access";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerGetEmailBuilderAccess: {
        readonly method: "GET";
        readonly path: "/v1/email-builder/access/{accessId}";
        readonly scope: "builder:read";
        readonly billable: false;
    };
    readonly customerCloseEmailBuilderAccess: {
        readonly method: "DELETE";
        readonly path: "/v1/email-builder/access/{accessId}";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerCreateVipEmailBuilderAccess: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-builder/access";
        readonly scope: "vip:builder";
        readonly billable: true;
        readonly consent: "expectedPrice";
    };
    readonly customerGetVipEmailBuilderAccess: {
        readonly method: "GET";
        readonly path: "/v1/vip/email-builder/access/{accessId}";
        readonly scope: "builder:read";
        readonly billable: false;
    };
    readonly customerDeleteVipEmailBuilderAccess: {
        readonly method: "DELETE";
        readonly path: "/v1/vip/email-builder/access/{accessId}";
        readonly scope: "vip:builder";
        readonly billable: false;
    };
    readonly customerStandardBuilderImport: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/import";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerStandardBuilderValidate: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/validate";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerStandardBuilderCompile: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/compile";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerStandardBuilderExport: {
        readonly method: "POST";
        readonly path: "/v1/email-builder/export";
        readonly scope: "builder:write";
        readonly billable: false;
    };
    readonly customerNativeBuilderImport: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-builder/import";
        readonly scope: "vip:builder";
        readonly billable: false;
    };
    readonly customerNativeBuilderValidate: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-builder/validate";
        readonly scope: "vip:builder";
        readonly billable: false;
    };
    readonly customerNativeBuilderCompile: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-builder/compile";
        readonly scope: "vip:builder";
        readonly billable: false;
    };
    readonly customerNativeBuilderExport: {
        readonly method: "POST";
        readonly path: "/v1/vip/email-builder/export";
        readonly scope: "vip:builder";
        readonly billable: false;
    };
    readonly customerListVipBuilderTemplates: {
        readonly method: "GET";
        readonly path: "/v1/vip/email-builder/templates";
        readonly scope: "vip:read";
        readonly billable: false;
    };
    readonly customerGetVipBuilderTemplate: {
        readonly method: "GET";
        readonly path: "/v1/vip/email-builder/templates/{templateId}";
        readonly scope: "vip:read";
        readonly billable: false;
    };
    readonly customerListStandardBuilderTemplates: {
        readonly method: "GET";
        readonly path: "/v1/email-builder/templates";
        readonly scope: "catalog:read";
        readonly billable: false;
    };
    readonly customerGetStandardBuilderTemplate: {
        readonly method: "GET";
        readonly path: "/v1/email-builder/templates/{templateId}";
        readonly scope: "catalog:read";
        readonly billable: false;
    };
};
export type SupportedOperation = keyof typeof operationCapabilities;
export type ConsentKind = "priceAuthorization" | "expectedPrice" | "editQuote" | "rewriteQuote";
export type ExpectedClassificationPricing = {
    classificationBaseMillicents: number;
    includedUniqueTerms: number;
    additionalTermMillicents: number;
    maximumClassificationMillicents: number;
};
export type BillableConsent = {
    kind: "priceAuthorization";
    expectedPricing: ExpectedClassificationPricing;
    maxChargeMillicents: number;
} | {
    kind: "expectedPrice";
    expectedPriceMillicents: number;
} | {
    kind: "editQuote";
    expected: {
        mode: "manual" | "remove_all";
        validatedTermCount: number;
        originalAnalysisPaidMillicents: number;
        editChargeMillicents: number;
        sessionTotalMillicents: number;
        currentBalanceMillicents: number;
        balanceAfterMillicents: number;
    };
} | {
    kind: "rewriteQuote";
    expected: {
        mode: "single" | "all";
        uniqueTermCount: number;
        minimumPerUniqueTermMillicents: number;
        minimumChargeMillicents: number;
        maximumChargeMillicents: number;
        currentBalanceMillicents: number;
        balanceAfterMaximumMillicents: number;
        vipActive: boolean;
    };
};
type BillableOperation = {
    [K in SupportedOperation]: (typeof operationCapabilities)[K]["billable"] extends true ? K : never;
}[SupportedOperation];
export type BridgeOperationInput<T extends SupportedOperation> = OperationInput<T> & (T extends BillableOperation ? {
    consent: BillableConsent;
} : {
    consent?: never;
});
export type HostedBuilderCapability = {
    available: true;
    modes: readonly ["standard", "vip"];
    integrationRequirements: readonly [
        "A server-minted opaque token with a short expiry",
        "Single-use atomic redemption bound to account, design, and allowed action",
        "An allowlisted HTTPS audience and origin",
        "No customer API key or bearer secret in browser URLs, storage, or messages",
        "Explicit save/export callbacks with origin, schema, size, and replay validation"
    ];
};
export declare const hostedBuilderCapability: HostedBuilderCapability;
export interface SendReputeClientOptions {
    /** Read this only from backend secret storage. The bridge never persists it. */
    secret: string;
    timeoutMs?: number;
    /**
     * Deliberately awkward test seam. Only HTTP(S) loopback is accepted here.
     * There is no production baseUrl override.
     */
    test?: {
        baseUrl: string;
        fetch?: typeof globalThis.fetch;
    };
}
/**
 * Return an exact trusted hosted-editor origin. Production is pinned to the
 * origin of the published API endpoint; loopback exists only behind the
 * explicit client test seam.
 */
export declare function exactHostedBuilderOrigin(value: string, allowLoopback?: boolean): string | null;
export declare function assertHostedBuilderLaunch(value: unknown, expectedState: string, expectedOrigin?: string, allowLoopback?: boolean): {
    launchUrl: string;
    state: string;
    expiresAt: string;
};
export declare class CampaignsBridgeError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly requestId?: string;
    readonly retryAfterSeconds?: number;
    constructor(code: string, message: string, details?: {
        status?: number;
        requestId?: string;
        retryAfterSeconds?: number;
    });
}
/** In-process evidence only; never reconstructed from an upstream JSON flag. */
export declare class PaidRequestNotDispatchedError extends CampaignsBridgeError {
    constructor(cause: unknown);
}
export interface ActivationResult {
    active: true;
    requiredScopes: readonly ["account:read", "catalog:read", "usage:read"];
    account: {
        creditMillicents: number;
        reorgDebtMillicents: number;
        paymentHold: boolean;
        disabled: boolean;
    };
    pricing: PricingSettings;
    usage: OperationResponse<"getCustomerApiUsage">;
}
export interface ConnectionSnapshot {
    balance: {
        availableMillicents: number;
        reorgDebtMillicents: number;
        paymentHold: boolean;
    };
    usage: OperationResponse<"getCustomerApiUsage">;
    vip: {
        status: "active" | "inactive" | "unknown";
        active: boolean | null;
        expiresAt: string | null;
        availability: "available" | "locked" | "unknown";
    };
    effectivePrices: {
        classifier: {
            baseMillicents: number;
            includedUniqueTerms: number;
            additionalTermMillicents: number;
            maximumMillicents: number;
            editTermMillicents: number;
            removeAllMillicents: number;
        };
        aiTemplateMillicents: number | null;
        nativeBuilderAccessMillicents: number;
        vipMonthlyMillicents: number;
    };
    capabilities: {
        operations: typeof operationCapabilities;
        keyScopesIntrospectable: false;
        hostedBuilder: HostedBuilderCapability;
        availability: {
            standardBuilder: "available";
            vipBuilder: "available" | "locked" | "unknown";
            vipStatus: "available" | "locked";
        };
    };
}
export declare class SendReputeClient {
    #private;
    campaignInsightsQuote(): Promise<InsightQuote>;
    campaignInsightsAnalyze(input: {
        analysisId: string;
        expectedPriceMillicents: number;
        consent: true;
        metrics: InsightMetrics;
        locale?: string;
    }): Promise<InsightResult>;
    constructor(options: SendReputeClientOptions);
    createHostedBuilderHandoff(input: {
        state: string;
        returnOrigin: string;
        initialMjml?: string;
        mode?: "standard" | "vip";
        vipAccessId?: string;
        initialDocument?: Record<string, unknown>;
    }): Promise<{
        launchUrl: string;
        state: string;
        expiresAt: string;
    }>;
    /** Authenticated read-only recovery through the same pinned SDK transport. */
    getPaidResult(recoveryId: string): Promise<OperationResponse<"customerGetPaidResult">>;
    /**
     * Free activation check. These GETs neither require a positive wallet balance
     * nor invoke classification, AI, email delivery, or a purchase.
     */
    validateActivation(): Promise<ActivationResult>;
    getConnectionSnapshot(): Promise<ConnectionSnapshot>;
    execute<T extends SupportedOperation>(operation: T, input: BridgeOperationInput<T>): Promise<OperationResponse<T>>;
}
export type { OperationInput, OperationResponse, PricingSettings, VipPlanQuote, VipState, } from "@sendrepute/node";
//# sourceMappingURL=index.d.ts.map