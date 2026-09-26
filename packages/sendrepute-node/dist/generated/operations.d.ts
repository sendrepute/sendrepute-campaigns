export type Account = {
    id: string;
    username: string;
    role: "admin" | "user";
    creditCents: number;
    creditMillicents: number;
    reorgDebtMillicents: number;
    paymentHold: boolean;
    freeClassificationsRemaining: number;
    successfulClassifications: number;
    classificationCompleted: boolean;
    disabled: boolean;
    createdAt: string;
    totpEnabled: boolean;
    recoveryCodeCount: number;
    classifierModelPreference: "thor" | "theos" | "athena" | "odin" | "freya" | "hermes" | "ares" | "apollo" | "small" | "large";
};
export type AiEmailTemplateResult = {
    document: EmailTemplateDocument | RawMjmlEmailDocument;
    chargeCents: number;
    accessId: string;
    balanceAfterMillicents: number;
    replayed: boolean;
};
export type AiReplacement = {
    term: string;
    replacement: string;
};
export type AiRewriteCharge = {
    reservationMillicents: number;
    finalMillicents: number;
    refundMillicents: number;
};
export type AiRewritePriceAuthorization = {
    expectedMinimumPerUniqueTermMillicents: number;
    maximumChargeMillicents: number;
};
export type AiRewriteQuote = {
    mode: "single" | "all";
    uniqueTermCount: number;
    minimumPerUniqueTermMillicents: number;
    minimumChargeMillicents: number;
    maximumChargeMillicents: number;
    currentBalanceMillicents: number;
    balanceAfterMaximumMillicents: number;
    vipActive: boolean;
};
export type AiRewriteQuoteInput = {
    parentRequestId: string;
    mode: "single" | "all";
    terms: Array<string>;
};
export type AiRewriteResult = {
    requestId: string;
    parentRequestId: string;
    mode: "single" | "all";
    input: RewrittenClassificationInput;
    classification: ClassificationResult;
    replacements: Array<AiReplacement>;
    charge: AiRewriteCharge;
    balanceAfterMillicents: number;
};
export type BitcoinInvoice = {
    id: string;
    amountCents: number;
    quotedSats: number;
    quotedBtcUsd: number;
    address: string;
    addressType: "p2pkh" | "p2sh_p2wpkh" | "p2wpkh";
    receivedSats: number;
    creditedCents: number;
    confirmations: number;
    requiredConfirmations: number;
    status: "pending" | "detected" | "confirming" | "partially_paid" | "credited" | "overpaid" | "expired" | "late" | "reorg_review";
    creditedAt?: unknown;
    unpaidClosedAt?: unknown;
    expiresAt: string;
    createdAt: string;
    offerId: unknown;
    offerTitle: unknown;
    offerEndsAt: unknown;
    bonusMillicents: number;
    purpose: "deposit" | "vip";
    vipPriceMillicents: unknown;
    newlyCreated?: boolean;
};
export type ClassificationReason = {
    signal: string;
    detail: string;
    weight: number;
};
export type ClassificationResult = {
    label: "inbox" | "spam";
    spamProbability: number;
    flaggedTermCount?: number;
    confidence: "low" | "medium" | "high";
    reasons: Array<ClassificationReason>;
    flaggedTerms: Array<string>;
    analyzedFields: Array<string>;
    modelVersion: string;
    analyzedAt: string;
    isFreePreview: boolean;
    freeClassificationsRemaining: number;
    contentAudit?: ContentAuditResult;
};
export type ContentAuditCounts = {
    words: number;
    links: number;
    images: number;
    triggerPhrases: number;
};
export type ContentAuditGoodPractice = {
    code: string;
    category: "subject" | "content" | "links" | "structure" | "compliance";
};
export type ContentAuditIssue = {
    code: string;
    category: "subject" | "content" | "links" | "structure" | "compliance";
    severity: "critical" | "warning" | "suggestion";
    deduction: number;
    evidence: string;
};
export type ContentAuditResult = {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    summary: "fix_critical" | "fix_warnings" | "review_suggestions" | "looks_good";
    counts: ContentAuditCounts;
    totalIssues: number;
    criticalCount: number;
    warningCount: number;
    suggestionCount: number;
    issues: Array<ContentAuditIssue>;
    goodPractices: Array<ContentAuditGoodPractice>;
    homoglyphTerms?: Array<string>;
    inputTruncated: boolean;
};
export type CreditLedgerEntry = {
    id: string;
    amountCents: number;
    balanceCents: number;
    amountMillicents: number;
    balanceMillicents: number;
    type: "classification" | "domain_ip_scan" | "ai_template" | "email_template_access" | "adjustment" | "bitcoin_deposit" | "bitcoin_reorg_reversal" | "usdt_deposit" | "usdt_reorg_reversal" | "deposit_bonus" | "deposit_bonus_reversal" | "referral_bonus" | "referral_bonus_reversal";
    description?: unknown;
    createdAt: string;
};
export type CustomerAiEmailTemplateInput = {
    expectedPriceMillicents?: number;
    content?: string;
    category?: "newsletter" | "transactional" | "personal" | "business" | "custom";
    subtype?: "weekly-digest" | "product-update" | "promotion" | "event-invitation" | "order-confirmation" | "shipping-update" | "payment-receipt" | "password-reset" | "account-alert" | "invitation" | "thank-you" | "congratulations" | "personal-update" | "introduction" | "announcement" | "follow-up" | "meeting-invitation" | "custom";
    recoveryId?: string;
};
export type CustomerAiRewriteInput = {
    parentRequestId: string;
    mode: "single" | "all";
    terms: Array<string>;
    priceAuthorization?: AiRewritePriceAuthorization;
};
export type CustomerApiBilling = {
    chargedMillicents: number;
    replayed: boolean;
};
export type CustomerApiError = {
    error: {
        code: string;
        message: string;
        retryAfterSeconds?: number;
    };
    requestId: string;
};
export type CustomerApiLimits = {
    requestsPerMinute: 60;
    concurrentRequests: 5;
};
export type CustomerApiModel = {
    id: CustomerModelFamily;
    name: string;
    available: boolean;
};
export type CustomerApiModelsResponse = {
    models: Array<CustomerApiModel>;
    defaultModel: CustomerModelFamily;
};
export type CustomerApiUsageResponse = {
    usage: CustomerUsage;
    limits: CustomerApiLimits;
};
export type CustomerBuilderCompileOptions = {
    cssMode?: "inline" | "head" | "hybrid";
    mediaQueries?: boolean;
    breakpoint?: number;
};
export type CustomerBuilderFix = {
    code: string;
    message: string;
};
export type CustomerBuilderWarning = {
    code: string;
    message: string;
    sourceUrl?: string;
};
export type CustomerCampaignInsightsAnalysis = {
    analysisId: string;
    priceMillicents: 10000 | 5000;
    result: CustomerCampaignInsightsResult;
    expiresAt: string;
};
export type CustomerCampaignInsightsAnalyzeInput = {
    analysisId: string;
    expectedPriceMillicents: 10000 | 5000;
    consent: true;
    locale?: "en" | "ru" | "uk" | "hi" | "de" | "fr" | "es" | "it" | "pt" | "ar" | "id" | "tr" | "zh" | "vi";
    metrics: CustomerCampaignInsightsMetrics;
};
export type CustomerCampaignInsightsMetrics = {
    sent?: number;
    delivered?: number;
    bounced?: number;
    hardBounced?: number;
    softBounced?: number;
    deferred?: number;
    failed?: number;
    opened?: number;
    uniqueOpened?: number;
    clicked?: number;
    uniqueClicked?: number;
    unsubscribed?: number;
    complaints?: number;
    accepted?: number;
    pending?: number;
    deliveryRate?: number;
    openRate?: number;
    clickRate?: number;
    bounceRate?: number;
    unsubscribeRate?: number;
    complaintRate?: number;
};
export type CustomerCampaignInsightsQuote = {
    priceMillicents: 10000 | 5000;
    currency: "USD";
    vip: boolean;
    retentionDays: 30;
};
export type CustomerCampaignInsightsQuoteInput = Record<string, unknown>;
export type CustomerCampaignInsightsResult = {
    summary: string;
    findings: Array<string>;
    recommendations: Array<string>;
    limitations: Array<string>;
};
export type CustomerClassificationExpectedPricing = {
    classificationBaseMillicents: number;
    includedUniqueTerms: number;
    additionalTermMillicents: number;
    maximumClassificationMillicents: number;
};
export type CustomerClassificationInput = {
    sender: string;
    subject: string;
    body: string;
    displayedAlternatives?: Array<CustomerDisplayedAlternative>;
    model?: CustomerModelFamily;
    priceAuthorization?: CustomerClassificationPriceAuthorization;
};
export type CustomerClassificationPriceAuthorization = {
    expectedPricing: CustomerClassificationExpectedPricing;
    maxChargeMillicents: number;
};
export type CustomerClassificationResponse = {
    requestId: string;
    model: CustomerModelFamily;
    result: CustomerClassificationResult;
    billing: CustomerApiBilling;
};
export type CustomerClassificationResult = {
    label: "inbox" | "spam";
    spamProbability: number;
    flaggedTermCount?: number;
    confidence: "low" | "medium" | "high";
    reasons: Array<ClassificationReason>;
    flaggedTerms: Array<string>;
    analyzedFields: Array<string>;
    modelVersion: string;
    analyzedAt: string;
    contentAudit?: ContentAuditResult;
};
export type CustomerDisplayedAlternative = {
    contentType: "text/plain" | "text/html";
    body: string;
};
export type CustomerEmailBuilderAccessInput = {
    designId: string;
    sourceKind: "curated" | "saved" | "blank";
    templateId?: string;
};
export type CustomerHostedBuilderHandoff = {
    launchUrl: string;
    state: string;
    expiresAt: string;
};
export type CustomerHostedBuilderHandoffInput = {
    state: string;
    returnOrigin: string;
    initialMjml?: string;
    mode?: "standard" | "vip";
    vipAccessId?: string;
    initialDocument?: CustomerNativeDocument;
};
export type CustomerManualEditInput = {
    sender: string;
    subject: string;
    body: string;
    parentRequestId: string;
    editedTerms: Array<string>;
    editMode: "manual" | "remove_all";
};
export type CustomerManualEditResult = {
    label: "inbox" | "spam";
    spamProbability: number;
    flaggedTermCount?: number;
    confidence: "low" | "medium" | "high";
    reasons: Array<ClassificationReason>;
    flaggedTerms: Array<string>;
    analyzedFields: Array<string>;
    modelVersion: string;
    analyzedAt: string;
    isFreePreview: boolean;
    freeClassificationsRemaining: number;
    contentAudit?: ContentAuditResult;
    requestId: string;
    replayed?: boolean;
};
export type CustomerModelFamily = "thor" | "theos" | "athena" | "odin" | "freya" | "hermes" | "ares" | "apollo";
export type CustomerNativeBlock = CustomerNativeTextBlock | CustomerNativeImageBlock | CustomerNativeButtonBlock | CustomerNativeSpacerBlock | CustomerNativeDividerBlock;
export type CustomerNativeBuilderCompileResult = {
    kind: "native";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    html: string;
};
export type CustomerNativeBuilderExportResult = CustomerNativeBuilderHtmlExportResult | CustomerNativeBuilderZipExportResult;
export type CustomerNativeBuilderHtmlExportResult = {
    kind: "native";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    html: string;
    filename: string;
    contentType: "text/html; charset=utf-8";
};
export type CustomerNativeBuilderImportResult = {
    kind: "native";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    document: CustomerNativeDocument;
};
export type CustomerNativeBuilderInput = {
    document: CustomerNativeDocument | string;
    accessId: string;
    options?: CustomerBuilderCompileOptions;
    filename?: string;
    format?: "html" | "zip";
};
export type CustomerNativeBuilderValidateResult = {
    kind: "native";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
};
export type CustomerNativeBuilderZipExportResult = {
    kind: "native";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    archiveBase64: string;
    encoding: "base64";
    filename: string;
    contentType: "application/zip";
    files: Array<string>;
};
export type CustomerNativeButtonBlock = {
    id: string;
    type: "button";
    text: string;
    url: string;
    background: string;
    color: string;
    align?: "left" | "center" | "right";
    width?: number;
    borderRadius?: number;
    fontSize?: number;
    padding?: number;
};
export type CustomerNativeColumn = {
    id: string;
    blocks: Array<CustomerNativeBlock>;
};
export type CustomerNativeDividerBlock = {
    id: string;
    type: "divider";
    color: string;
};
export type CustomerNativeDocument = {
    version: 1;
    title: string;
    senderName?: string;
    preheader: string;
    lang: string;
    direction: "ltr" | "rtl";
    width: number;
    background: string;
    foreground: string;
    fontFamily: string;
    rows: Array<CustomerNativeRow>;
};
export type CustomerNativeImageBlock = {
    id: string;
    type: "image";
    src: string;
    alt: string;
    width: number;
    url?: string;
    align?: "left" | "center" | "right";
    borderRadius?: number;
};
export type CustomerNativeRow = {
    id: string;
    background: string;
    padding: number;
    columns: Array<CustomerNativeColumn>;
    gap?: number;
    borderRadius?: number;
    borderColor?: string;
    borderWidth?: number;
    stackOnMobile?: boolean;
};
export type CustomerNativeSpacerBlock = {
    id: string;
    type: "spacer";
    height: number;
};
export type CustomerNativeTextBlock = {
    id: string;
    type: "text";
    text: string;
    fontSize: number;
    color: string;
    align: "left" | "center" | "right";
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
    padding?: number;
};
export type CustomerStandardBuilderCompileResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    html: string;
};
export type CustomerStandardBuilderExportResult = CustomerStandardBuilderHtmlExportResult | CustomerStandardBuilderZipExportResult | CustomerStandardBuilderMjmlExportResult;
export type CustomerStandardBuilderHtmlExportResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    html: string;
    filename: string;
    contentType: "text/html; charset=utf-8";
};
export type CustomerStandardBuilderImportResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    mjml: string;
};
export type CustomerStandardBuilderInput = {
    mjml: string;
    filename?: string;
    format?: "html" | "mjml" | "zip";
};
export type CustomerStandardBuilderMjmlExportResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    mjml: string;
    filename: string;
    contentType: "text/plain; charset=utf-8";
};
export type CustomerStandardBuilderValidateResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
};
export type CustomerStandardBuilderZipExportResult = {
    kind: "mjml";
    valid: true;
    storage: "stateless";
    warnings: Array<CustomerBuilderWarning>;
    fixes: Array<CustomerBuilderFix>;
    stats: {
        htmlBytes: number;
    };
    archiveBase64: string;
    encoding: "base64";
    filename: string;
    contentType: "application/zip";
    files: Array<string>;
};
export type CustomerStandardTemplateCatalog = {
    templates: Array<{
        id: string;
        name: string;
        description: string;
        category: "Newsletter" | "Transactional" | "Basic";
    }>;
};
export type CustomerStandardTemplateDetail = {
    templateId: string;
    template: CustomerStandardTemplateRecipe;
    mjml?: string;
    storage: "stateless";
};
export type CustomerStandardTemplateRecipe = {
    id: string;
    name: string;
    description: string;
    category: "Newsletter" | "Transactional" | "Basic";
    sections: Array<"header" | "hero" | "text" | "two-column" | "image" | "button" | "divider" | "spacer" | "product-pair" | "quote" | "social" | "footer">;
    title: string;
    subject: string;
    headline: string;
    body: string;
    cta: string;
    palette: Array<string>;
};
export type CustomerUsage = {
    requestCount: number;
    successCount: number;
    errorCount: number;
    chargedMillicents: number;
    periodStart: string;
    periodEnd: string;
};
export type CustomerVipBuilderAccessInput = {
    designId: string;
    sourceKind: "template" | "blank";
    templateId?: string;
    expectedPriceMillicents: number;
};
export type CustomerVipEmailTemplateInput = {
    prompt: string;
    expectedPriceMillicents: number;
    imageUrls?: Array<string>;
    recoveryId?: string;
};
export type CustomerVipEmailTemplateResult = {
    document: CustomerNativeDocument;
    designId: string;
    nativeAccessId: string;
    chargeMillicents: number;
    balanceAfterMillicents: number;
    replayed: boolean;
};
export type CustomerVipPurchaseInput = {
    expectedPriceMillicents: number;
};
export type CustomerVipTemplateCatalog = {
    templates: Array<{
        id: string;
        title: string;
        description: string;
        category: "Newsletter" | "Transactional" | "Personal" | "Business";
    }>;
};
export type CustomerVipTemplateDocument = {
    templateId: string;
    document: CustomerNativeDocument;
    previewHtml?: string;
    storage: "stateless";
};
export type DepositBonusOffer = {
    id: string;
    enabled: boolean;
    title: string;
    startsAt: string;
    endsAt: string;
    tiers: Array<DepositBonusTier>;
};
export type DepositBonusTier = {
    paidCents: 1000 | 5000 | 10000 | 50000;
    totalCreditedMillicents: number;
};
export type EditQuote = {
    mode: "manual" | "remove_all";
    validatedTermCount: number;
    originalAnalysisPaidMillicents: number;
    editChargeMillicents: number;
    sessionTotalMillicents: number;
    currentBalanceMillicents: number;
    balanceAfterMillicents: number;
};
export type EditQuoteInput = {
    parentRequestId: string;
    editMode: "manual" | "remove_all";
    terms: Array<string>;
};
export type EmailBuilderAccess = {
    requestId: string;
    accessId: string;
    designId: string;
    chargedMillicents: number;
    balanceAfterMillicents: number;
    replayed: boolean;
};
export type EmailBuilderActiveAccess = {
    accessId: string;
    designId: string;
    sourceKind: "curated" | "saved" | "blank" | "ai";
};
export type EmailTemplateDocument = {
    version: 2;
    id: string;
    title: string;
    subject: string;
    sender: string;
    bodyBackground: string;
    sections: Array<EmailTemplateSection>;
};
export type EmailTemplateSection = {
    id: string;
    type: "header" | "hero" | "text" | "two-column" | "image" | "button" | "divider" | "spacer" | "product-pair" | "quote" | "social" | "footer" | "raw" | "logo-bar" | "preheader" | "announcement" | "feature-cards" | "icon-list" | "numbered-steps" | "article-list" | "faq-block" | "product-card" | "product-grid" | "coupon-block" | "pricing-comparison" | "countdown-section" | "review-rating" | "contact-details" | "legal-notice" | "app-downloads" | "multi-button" | "text-link";
    background: string;
    padding: number;
    align: "left" | "center" | "right";
    color: string;
    fontSize: number;
    heading?: string;
    text?: string;
    label?: string;
    url?: string;
    imageUrl?: string;
    alt?: string;
    imageUrl2?: string;
    alt2?: string;
    url2?: string;
    label2?: string;
    stackOnMobile?: boolean;
    height?: number;
    rawMjml?: string;
    items?: Array<EmailTemplateSectionItem>;
};
export type EmailTemplateSectionItem = {
    id: string;
    heading?: string;
    text?: string;
    imageUrl?: string;
    alt?: string;
    url?: string;
    label?: string;
};
export type InvoiceInput = {
    amountCents?: number;
    offerId?: string;
    purpose?: "deposit" | "vip";
    expectedPriceMillicents?: number;
};
export type PaymentMethod = {
    id: "btc";
    name: string;
    network: string;
    enabled: boolean;
};
export type PricingSettings = {
    classificationBaseCents: number;
    includedUniqueTerms: number;
    additionalTermCents: number;
    maximumClassificationCents: number;
    maximumTermsThreshold: number;
    editTermCents: number;
    classificationBaseMillicents: number;
    additionalTermMillicents: number;
    maximumClassificationMillicents: number;
    editTermMillicents: number;
    removeAllMillicents: number;
    aiMinimumPerUniqueTermMillicents: number;
};
export type RawMjmlEmailDocument = {
    kind: "mjml";
    version: 1;
    id: string;
    title: string;
    subject: string;
    sender: string;
    mjml: string;
};
export type ReferralActivity = {
    id: string;
    registeredAt: string;
    status: "pending" | "rewarded" | "reversed";
    rewardMillicents: number;
};
export type ReferralDashboard = {
    referralCode: string;
    rewardPercent: 10;
    totalReferrals: number;
    paidReferrals: number;
    totalRewardMillicents: number;
    page: number;
    pageSize: number;
    totalPages: number;
    referrals: Array<ReferralActivity>;
};
export type RewrittenClassificationInput = {
    sender: string;
    subject: string;
    body: string;
};
export type VipBuilderAccess = {
    accessId: string;
    designId: string;
    sourceKind: "template" | "blank" | "ai";
    templateId?: unknown;
    chargeMillicents: number;
    balanceAfterMillicents?: number;
    replayed?: boolean;
    createdAt?: string;
};
export type VipClassifierPrices = {
    baseMillicents: number;
    additionalTermMillicents: number;
    maximumMillicents: number;
    editTermMillicents: number;
    removeAllMillicents: number;
};
export type VipPlanQuote = {
    monthlyPriceMillicents: number;
    classifier: VipClassifierPrices;
    templateAccessPriceMillicents: number;
    aiTemplatePriceMillicents: number;
    normalComparison: {
        classifier: VipClassifierPrices;
        templateAccessPriceMillicents: number;
    };
    terms: {
        manualRenewal: true;
        unlimited: false;
        bitcoinPrincipalCreditedToWallet: false;
    };
    updatedAt: string;
};
export type VipPurchaseResult = {
    active: boolean;
    startsAt: string;
    expiresAt: string;
    chargedMillicents: number;
    balanceAfterMillicents: number;
    replayed: boolean;
};
export type VipState = {
    active: boolean;
    startsAt: unknown;
    expiresAt: unknown;
    monthlyPriceMillicents: number;
    classifier: VipClassifierPrices;
    templateAccessPriceMillicents: number;
    aiTemplatePriceMillicents: number;
    regularAiTemplatePriceMillicents: number;
    templateIds: Array<string>;
};
export interface OperationMap {
    classifyCustomerEmail: {
        input: {
            body: CustomerClassificationInput;
        };
        response: CustomerClassificationResponse;
    };
    customerAccessEmailBuilder: {
        input: {
            body: CustomerEmailBuilderAccessInput;
        };
        response: EmailBuilderAccess;
    };
    customerAnalyzeCampaignInsights: {
        input: {
            body: CustomerCampaignInsightsAnalyzeInput;
        };
        response: CustomerCampaignInsightsAnalysis;
    };
    customerClassifyEmail: {
        input: {
            body: CustomerManualEditInput;
        };
        response: CustomerManualEditResult;
    };
    customerCloseEmailBuilderAccess: {
        input: {
            path: {
                accessId: string;
            };
        };
        response: undefined;
    };
    customerCreateAiEmailTemplate: {
        input: {
            body: CustomerAiEmailTemplateInput;
        };
        response: AiEmailTemplateResult;
    };
    customerCreateHostedBuilderHandoff: {
        input: {
            body: CustomerHostedBuilderHandoffInput;
        };
        response: CustomerHostedBuilderHandoff;
    };
    customerCreatePaymentInvoice: {
        input: {
            body: InvoiceInput;
        };
        response: BitcoinInvoice;
    };
    customerCreateVipEmailBuilderAccess: {
        input: {
            body: CustomerVipBuilderAccessInput;
        };
        response: VipBuilderAccess;
    };
    customerCreateVipEmailTemplate: {
        input: {
            body: CustomerVipEmailTemplateInput;
        };
        response: CustomerVipEmailTemplateResult;
    };
    customerDeletePaymentInvoice: {
        input: {
            path: {
                invoiceId: string;
            };
        };
        response: undefined;
    };
    customerDeleteVipEmailBuilderAccess: {
        input: {
            path: {
                accessId: string;
            };
        };
        response: undefined;
    };
    customerGetAccount: {
        input: Record<string, never>;
        response: Account;
    };
    customerGetAccountReferrals: {
        input: {
            query?: {
                page?: number;
                pageSize?: number;
            };
        };
        response: ReferralDashboard;
    };
    customerGetActiveDepositOffer: {
        input: Record<string, never>;
        response: DepositBonusOffer | null;
    };
    customerGetCreditLedger: {
        input: {
            query?: {
                kind?: "usage" | "payments";
                limit?: number;
                offset?: number;
            };
        };
        response: Array<CreditLedgerEntry>;
    };
    customerGetEmailBuilderAccess: {
        input: {
            query?: {
                designId?: string;
            };
            path: {
                accessId: string;
            };
        };
        response: EmailBuilderActiveAccess;
    };
    customerGetPaidResult: {
        input: {
            path: {
                recoveryId: string;
            };
        };
        response: {
            status: "pending" | "succeeded" | "failed";
            operation: "customerStandardAiGenerate" | "customerVipAiGenerate";
            result?: {
                [key: string]: unknown;
            };
            error?: {
                [key: string]: unknown;
            };
        };
    };
    customerGetPricingSettings: {
        input: Record<string, never>;
        response: PricingSettings;
    };
    customerGetStandardBuilderTemplate: {
        input: {
            path: {
                templateId: string;
            };
        };
        response: CustomerStandardTemplateDetail;
    };
    customerGetVip: {
        input: Record<string, never>;
        response: VipState;
    };
    customerGetVipBuilderTemplate: {
        input: {
            path: {
                templateId: string;
            };
        };
        response: CustomerVipTemplateDocument;
    };
    customerGetVipEmailBuilderAccess: {
        input: {
            path: {
                accessId: string;
            };
        };
        response: VipBuilderAccess;
    };
    customerGetVipPlans: {
        input: Record<string, never>;
        response: VipPlanQuote;
    };
    customerListPaymentInvoices: {
        input: {
            query?: {
                limit?: number;
                offset?: number;
            };
        };
        response: Array<BitcoinInvoice>;
    };
    customerListPaymentMethods: {
        input: Record<string, never>;
        response: Array<PaymentMethod>;
    };
    customerListStandardBuilderTemplates: {
        input: Record<string, never>;
        response: CustomerStandardTemplateCatalog;
    };
    customerListVipBuilderTemplates: {
        input: Record<string, never>;
        response: CustomerVipTemplateCatalog;
    };
    customerNativeBuilderCompile: {
        input: {
            body: CustomerNativeBuilderInput;
        };
        response: CustomerNativeBuilderCompileResult;
    };
    customerNativeBuilderExport: {
        input: {
            body: CustomerNativeBuilderInput;
        };
        response: CustomerNativeBuilderExportResult;
    };
    customerNativeBuilderImport: {
        input: {
            body: CustomerNativeBuilderInput;
        };
        response: CustomerNativeBuilderImportResult;
    };
    customerNativeBuilderValidate: {
        input: {
            body: CustomerNativeBuilderInput;
        };
        response: CustomerNativeBuilderValidateResult;
    };
    customerPurchaseVip: {
        input: {
            body: CustomerVipPurchaseInput;
        };
        response: VipPurchaseResult;
    };
    customerQuoteAiRewrite: {
        input: {
            body: AiRewriteQuoteInput;
        };
        response: AiRewriteQuote;
    };
    customerQuoteCampaignInsights: {
        input: {
            body: CustomerCampaignInsightsQuoteInput;
        };
        response: CustomerCampaignInsightsQuote;
    };
    customerQuoteClassificationEdit: {
        input: {
            body: EditQuoteInput;
        };
        response: EditQuote;
    };
    customerQuoteManualClassificationEdit: {
        input: {
            body: EditQuoteInput;
        };
        response: EditQuote;
    };
    customerRefreshMyPayments: {
        input: Record<string, never>;
        response: Array<BitcoinInvoice>;
    };
    customerRewriteFlaggedTermsWithAi: {
        input: {
            body: CustomerAiRewriteInput;
        };
        response: AiRewriteResult;
    };
    customerStandardBuilderCompile: {
        input: {
            body: CustomerStandardBuilderInput;
        };
        response: CustomerStandardBuilderCompileResult;
    };
    customerStandardBuilderExport: {
        input: {
            body: CustomerStandardBuilderInput;
        };
        response: CustomerStandardBuilderExportResult;
    };
    customerStandardBuilderImport: {
        input: {
            body: CustomerStandardBuilderInput;
        };
        response: CustomerStandardBuilderImportResult;
    };
    customerStandardBuilderValidate: {
        input: {
            body: CustomerStandardBuilderInput;
        };
        response: CustomerStandardBuilderValidateResult;
    };
    getCustomerApiModels: {
        input: Record<string, never>;
        response: CustomerApiModelsResponse;
    };
    getCustomerApiUsage: {
        input: Record<string, never>;
        response: CustomerApiUsageResponse;
    };
}
export type OperationId = keyof OperationMap;
export type OperationInput<T extends OperationId> = OperationMap[T]["input"];
export type OperationResponse<T extends OperationId> = OperationMap[T]["response"];
export declare const operationMetadata: Readonly<Record<OperationId, {
    readonly method: string;
    readonly path: string;
}>>;
//# sourceMappingURL=operations.d.ts.map