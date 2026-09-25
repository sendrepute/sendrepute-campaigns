# Available SendRepute services

This server-only package calls the published customer API at
`https://www.sendrepute.com/api`. It does not copy application internals,
persist API keys, send email, promise inbox placement, or expose a browser SDK.
The key must be loaded by the integrating backend from its own encrypted secret
store. API keys are never returned in values or error messages.

`validateActivation()` performs only `GET /v1/account`, `GET /v1/pricing`, and
`GET /v1/usage`. These require `account:read`, `catalog:read`, and `usage:read`.
They do not charge and do not require a positive balance.

## Exact allowlist

| Scope | Method and path | Bridge operation | Charge/constraint |
|---|---|---|---|
| `models:read` | `GET /v1/models` | `getCustomerApiModels` | Free |
| `usage:read` | `GET /v1/usage` | `getCustomerApiUsage` | Free |
| `classify` | `POST /v1/classify` | `classifyCustomerEmail` | Paid; bridge verifies current pricing and supplies `priceAuthorization` |
| `account:read` | `GET /v1/account`, `/v1/account/referrals` | `customerGetAccount`, `customerGetAccountReferrals` | Free |
| `billing:read` | `GET /v1/account/ledger`, `/v1/payments/invoices`, `/v1/payments/methods`, `/v1/payments/deposit-offer` | `customerGetCreditLedger`, `customerListPaymentInvoices`, `customerListPaymentMethods`, `customerGetActiveDepositOffer` | Free reads |
| `billing:write` | `POST /v1/payments/invoices`, `POST /v1/payments/refresh`, `DELETE /v1/payments/invoices/{invoiceId}` | `customerCreatePaymentInvoice`, `customerRefreshMyPayments`, `customerDeletePaymentInvoice` | Payment administration; invoice creation is not a wallet debit |
| `catalog:read` | `GET /v1/pricing`, `/v1/vip/plans` | `customerGetPricingSettings`, `customerGetVipPlans` | Free |
| `vip:read` | `GET /v1/vip` | `customerGetVip` | Free |
| `vip:purchase` | `POST /v1/vip/purchase` | `customerPurchaseVip` | Paid; explicit expected price |
| `rewrite` | `POST /v1/rewrite/quote` | `customerQuoteClassificationEdit` | Free deprecated manual-edit quote alias; not an AI quote |
| `classify` | `POST /v1/classify/edit/quote`, `POST /v1/classify/edit` | `customerQuoteManualClassificationEdit`, `customerClassifyEmail` | Quote is free; paid edit requires an exactly matching fresh quote |
| `rewrite` | `POST /v1/rewrite/ai-quote` | `customerQuoteAiRewrite` | Free authoritative effective-rate and maximum-charge quote |
| `rewrite` | `POST /v1/rewrite` | `customerRewriteFlaggedTermsWithAi` | Paid; submit the quoted effective minimum rate and maximum charge |
| `ai:generate` | `POST /v1/email-builder/ai-template`, `/v1/vip/email-template` | `customerCreateAiEmailTemplate`, `customerCreateVipEmailTemplate` | Paid; explicit expected price; VIP route also needs active VIP |
| `builder:write` | `POST /v1/email-builder/access`, `DELETE /v1/email-builder/access/{accessId}` | `customerAccessEmailBuilder`, `customerCloseEmailBuilderAccess` | Free standard access lifecycle |
| `builder:read` | `GET /v1/email-builder/access/{accessId}`, `GET /v1/vip/email-builder/access/{accessId}` | `customerGetEmailBuilderAccess`, `customerGetVipEmailBuilderAccess` | Free; owned access only |
| `vip:builder` | `POST /v1/vip/email-builder/access`, `DELETE /v1/vip/email-builder/access/{accessId}` | `customerCreateVipEmailBuilderAccess`, `customerDeleteVipEmailBuilderAccess` | Creation is paid with expected price and active VIP; delete is free |
| `builder:write` | `POST /v1/email-builder/{import,validate,compile,export}` | `customerStandardBuilderImport`, `customerStandardBuilderValidate`, `customerStandardBuilderCompile`, `customerStandardBuilderExport` | Stateless, free; 512 KiB JSON, 4,000 MJML elements, 2 MiB HTML |
| `vip:builder` | `POST /v1/vip/email-builder/{import,validate,compile,export}` | `customerNativeBuilderImport`, `customerNativeBuilderValidate`, `customerNativeBuilderCompile`, `customerNativeBuilderExport` | Stateless, free operation but needs active VIP and owned open access |
| `catalog:read` | `GET /v1/email-builder/templates`, `/v1/email-builder/templates/{templateId}` | `customerListStandardBuilderTemplates`, `customerGetStandardBuilderTemplate` | Free gallery recipes, not saved designs |
| `vip:read` | `GET /v1/vip/email-builder/templates`, `/v1/vip/email-builder/templates/{templateId}` | `customerListVipBuilderTemplates`, `customerGetVipBuilderTemplate` | Free built-ins; active VIP required |

The bridge rejects request representations over 4 MiB. Responses are bounded
by the underlying published SDK to 16 MiB. Requests use a configurable timeout;
the default is 30 seconds except AI template generation, which uses 120 seconds
to cover the central endpoint's 90-second provider deadline plus validation and
settlement. An explicitly configured timeout applies to every operation.
Redirects are rejected so a bearer secret cannot follow a redirect. The bridge
sets retries to zero for every operation: in particular, no paid action is
automatically retried.

Campaigns session CSRF and customer API authentication are separate boundaries.
Browser mutations under `/api/campaigns` require the Campaigns session cookie
and `x-campaigns-csrf`; the bridge never forwards either. Its server-to-server
requests use only `Authorization: Bearer <customer API key>`. Customer API 401
and 403 status codes, safe error codes, and bounded request IDs are preserved as
`CampaignsBridgeError` fields without including the key.

VIP status is optional during activation. `INSUFFICIENT_SCOPE` from
`GET /v1/vip`, or a 404 from an older deployment without that optional route,
produces unknown/locked VIP availability and does not invalidate a key that
passes the three minimum activation reads. Other 403 responses, including
`ACCOUNT_DISABLED`, are not swallowed.

## Route wiring audit

The checked-in central Node API mounts the Campaigns router at
`/api/campaigns` (`app.ts` mounts the API router at `/api`; `routes/index.ts`
mounts Campaigns at `/campaigns`). The standalone CLI mounts the same router
directly at `/api/campaigns`. Thus activation, refresh, and the allowlisted
proxy are respectively `PUT /api/campaigns/connection`,
`POST /api/campaigns/connection/refresh`, and
`POST /api/campaigns/sendrepute` in both Node layouts.

This is a source-wiring audit, not a deployment assertion. The Cloudflare
Worker is a separate runtime and does not mount `@workspace/campaigns-server`;
deployments using that Worker alone do not thereby expose the Campaigns
router. No authenticated live account request is part of bridge verification.

## Builder integration

`hostedBuilderCapability.available` is `true` for standard and VIP native
handoffs. Launches are minted server-to-server, use short-lived single-use
codes and a restricted cookie, and return only through the API-key-pinned exact
Campaigns origin. The customer API key never appears in URLs, browser storage,
or `postMessage`.

VIP launch requires active membership plus an owned open access entitlement.
Purchasing that entitlement remains a separate explicit expected-price
consented operation and never occurs during launch.