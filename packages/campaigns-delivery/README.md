# `@workspace/campaigns-delivery`

Server-only delivery adapters for SendRepute Campaigns. Requires Node.js 20+.

## API

```ts
import { sendMessage, verifyProvider, DeliveryError } from "@workspace/campaigns-delivery";

const result = await sendMessage(config, {
  id: "campaign-attempt-123",
  from: { email: "sender@example.com", name: "Sender" },
  to: { email: "recipient@example.net", name: "Recipient" },
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" }
});
```

`ProviderConfig` is a discriminated union:

- `{ type: "ses", region, accessKeyId, secretAccessKey, sessionToken?, configurationSetName? }`
- `{ type: "mailjet", apiKey, secretKey, transport?: "api" | "smtp", smtpPort?: 465 | 587 }`
- `{ type: "smtpcom", apiKey, channel }`
- `{ type: "sendgrid", apiKey }`
- `{ type: "mailgun", apiKey, domain, region?: "us" | "eu" }`
- `{ type: "postmark", serverToken, transport?: "api" | "smtp" }`
- `{ type: "resend", apiKey }`
- `{ type: "brevo", apiKey }`
- `{ type: "smtp", host, port, secure?, username?, password?, requireTls?, allowPrivateHost? }`

`sendMessage(config, message, options?)` resolves to `{ providerMessageId?, status: "accepted" }`. A `DeliveryError` has `deliveryState`: `not-sent` (validation/preflight), `rejected` (definitive provider rejection), or `unknown` (the request may have been accepted). Callers must not automatically retry or fall back when the state is `unknown`.

`verifyProvider(config, options?)` performs a non-sending check: SES `GetAccount`, Mailjet profile retrieval or SMTP relay authentication, SMTP.com account retrieval, or SMTP `verify()` (connect/authenticate only). SMTP.com's required channel is validated locally; its account endpoint authenticates the Bearer key without sending.

Native API verification uses fixed read-only endpoints: SendGrid scopes, Mailgun domain details on the selected fixed US/EU origin, Postmark server details, Resend domains, and Brevo account details. SendGrid and Resend send-only keys can legitimately receive 403 from those read endpoints; this returns `verification: "inconclusive"` rather than claiming the send credential is invalid.

## Support and safety

- SES uses the SES v2 HTTPS API with native AWS SigV4 signing and temporary credential tokens. SNS webhooks are verified by default with AWS's canonical field order, SignatureVersion 1 (RSA-SHA1) or 2 (RSA-SHA256), a strict regional Amazon SNS certificate URL, pinned public DNS resolution, bounded certificate retrieval, and an explicit `expectedTopicArns` allowlist.
- Mailjet uses Send API v3.1 by default. Its SMTP mode uses the fixed `in-v3.mailjet.com` relay, implicit TLS on 465 or required STARTTLS on 587, with the API key and secret as SMTP credentials.
- Campaigns renders its own `{{variable}}` merge fields per recipient before delivery. The Mailjet API adapter sends that final subject and `HTMLPart`/`TextPart` directly: it does not set `TemplateID`, `Variables`, or `TemplateLanguage`. Mailjet's hosted-template mode is separate (a stored `TemplateID` request should not include `HTMLPart`/`TextPart`) and is not implemented here. Without `TemplateLanguage: true`, Mailjet does not evaluate provider template expressions; Campaigns' local renderer does not understand Mailjet's conditional/loop syntax or `{{var:...}}`, which can remain literal in final content. Review/import templates accordingly. HTML merge values are escaped, but template-authored HTML itself is not sanitized.
- Custom message headers are passed through (including `List-Unsubscribe` and `List-Unsubscribe-Post`), but callers cannot override generated address, MIME, or signing fields. Mailjet API rejects provider template controls (`X-MJ-TemplateID`, `X-MJ-TemplateLanguage`, `X-MJ-Vars`) because this adapter sends already-rendered content. Mailjet SMTP intentionally forwards custom `X-MJ-*` controls to its relay; integrations should not supply them when using locally rendered Campaigns content. Campaigns' normal worker supplies only unsubscribe headers.
- SMTP.com uses the documented v4 `POST /v4/messages` body (`channel`, `recipients`, `originator`, `subject`, and MIME `body.parts`).
- SendGrid, Mailgun (fixed US/EU origins), Postmark, Resend, and Brevo use their fixed HTTPS send APIs and native authentication headers. Resend requests include the delivery attempt as an idempotency key.
- Postmark SMTP mode uses only `smtp.postmarkapp.com:587`, requires STARTTLS, and supplies the encrypted server token as both SMTP username and password without persisting it in public provider metadata.
- SMTP uses nodemailer, validates TLS certificates, requires TLS in `NODE_ENV=production`, rejects private/reserved resolutions by default, and pins a validated DNS result for the connection. Set `allowPrivateHost` only for a trusted internal relay.
- SMTP connections (generic, Mailjet SMTP, and Postmark SMTP) originate from the installed Campaigns Node process, not a SendRepute central SMTP proxy. API transports use provider HTTPS endpoints from the same local process. A send timeout after submission can mean accepted or lost: `unknown` is never safe for automatic retry.
- For RFC 8058 one-click delivery, the provider/relay must preserve and DKIM-sign the final `List-Unsubscribe` and `List-Unsubscribe-Post` headers. This adapter supplies headers but does not control the provider's DKIM signature; verify a delivered message at the receiving mailbox.
- HTTPS endpoints are fixed, redirects are disabled, requests time out, and response bodies are bounded. Errors never include credentials or raw provider bodies.
- `DeliveryOptions` permits injected `fetch`, DNS resolver, and SMTP transport factory for offline tests.

Webhook helpers only parse authenticated input. `parseTokenWebhook` requires an application-configured, constant-time checked token (for Mailjet or SMTP.com callback URLs). `parseSesSnsWebhook` has a built-in Amazon SNS verifier and requires `expectedTopicArns`; certificate fetch, DNS, clock, and a custom verifier remain injectable for offline tests. Signed `SubscriptionConfirmation` messages are returned to the caller, but the library never follows `SubscribeURL`. Complete confirmation explicitly with the AWS console or `aws sns confirm-subscription --topic-arn … --token …`. Certificate redirects and non-Amazon, HTTP, query-bearing, or oversized certificate URLs are rejected.

No verification operation sends an email. No paid/network probe is run by this package's tests.