# Provider analytics and event callbacks

The in-app **Docs → Providers → Provider analytics and webhook setup** reference
contains per-provider steps. Configure a public HTTPS installation URL before
provisioning callbacks. Keep credentials in the provider console only; never
share signed URLs, Basic passwords or webhook signing secrets in logs. Enable
analytics and tracking flags explicitly, then verify provider-generated test
events in the provider analytics view. A saved endpoint is not proof of delivery.

| Connection | Provider-event ingest | History read | Setup / limitations |
| --- | --- | --- | --- |
| Mailjet API or Mailjet SMTP | Dedicated Basic authenticated event callback | Known exact message IDs, recent 100 only | Use provider edit “Provision / reveal”; configure Mailjet Event Tracking sent, bounce, blocked, spam, open, click and unsubscribe. Polling 404 and older IDs remain unknown. |
| Amazon SES API | Signed SNS, allowed topic ARNs | None | Enter `snsTopicArns` on the SES provider form, publish configuration-set events to SNS, subscribe the HTTPS `/api/campaigns/webhooks/<provider ID>` endpoint and confirm subscription manually in AWS. SNS cert and signatures are verified. |
| Mailgun API | Timestamped signing-key callback | Domain-scoped event API | Save the Mailgun webhook Signing Key in provider edit and configure the displayed HTTPS callback in Mailgun. |
| SendGrid API | Signed ECDSA event callback | Email Activity API; account entitlement required | Save the SendGrid signature verification public key in provider edit; turn on Signed Event Webhook in SendGrid. 403/permission failure is not zero events. |
| Resend API | Signed Svix-compatible callback | Known message IDs; last event only | Save the `whsec_` signing secret in provider edit; select events in Resend. No complete event history is implied by the known-ID read. |
| Postmark API / Postmark SMTP | Dedicated Basic authenticated callback | Outbound message details/events | Reveal dedicated Basic credentials in provider edit; paste the authenticated HTTPS callback into Postmark webhooks. Select delivery, bounce, open, click, spam complaint and subscription events where offered. Postmark does not sign webhooks; it recommends Basic authentication and optionally provider IP allowlisting. |
| Brevo API | Dedicated Basic authenticated callback | SMTP statistics events | Reveal dedicated Basic credentials in provider edit; paste the authenticated HTTPS URL into a Brevo **transactional** webhook. Choose delivered, soft/hard bounce, complaint, opening, click and unsubscribe. Brevo also documents bearer authentication but this installation uses its documented Basic URL method. Provider retention/permissions apply to polling. |
| SMTP.com API | No verified supported callback | None | Provider public API documentation confirmed sending authentication, not event callback authentication or payload schema. Legacy manual bearer receiver is not a supported self-service integration; analytics is unavailable until officially documented callback support can be validated. |
| Generic SMTP / other SMTP presets | None | None | SMTP accept is not delivered. Separate opt-in local open/click tracking is documented in `lib/campaigns-server/SMTP-TRACKING.md`; pixels can be blocked and scanners can click. |

Webhook notifications require matching locally sent message IDs. Signed
callbacks have bounded timestamp freshness, SNS enforces a topic allowlist,
and duplicate events are persisted idempotently. Provider API acceptance
never proves recipient delivery or inbox placement. Missing provider history
and disabled metrics must be treated as **unknown**, not zero.
# Operations, upgrades, backups, and troubleshooting

## Upgrade

1. Read the release notes and verify the new archive checksum/signature.
2. Take and verify both a PostgreSQL backup and a copy of application data.
3. Keep the old release and encryption key available for rollback.
4. Extract the new release separately, preserve the existing `.env` and named
   volumes, then run `docker compose up -d --build`.
5. Confirm the health endpoint, login, provider verification, and a test
   message before resuming schedules.

Never run two application versions against the same database during migration.
Database migrations may make application rollback impossible without restoring
the matching pre-upgrade database **and** data directory.

## Backup and restore

Back up PostgreSQL with a consistent `pg_dump` (custom format recommended) and
back up the application data directory/volume, `.env`, and encryption key using
encrypted storage with restricted access. Provider credentials and account
data are sensitive. Keep multiple off-host generations and periodically test a
restore on an isolated host.

An in-app Campaigns export is useful for logical portability but is not a
complete infrastructure backup. PostgreSQL dumps, application files, secrets,
release version, and configuration must correspond. Restoring a database
without the original encryption key can make encrypted provider credentials
unrecoverable. Restoring over a live instance can overwrite newer writes and
replay pending schedules or webhook state; stop sending and isolate outbound
mail first.

Campaigns logical backup format version 2 includes custom-field definitions and
saved audience segments. It deliberately excludes delivery jobs and immutable
delivery events. Restoring a version 2 export never changes delivery history
and never queues mail. Keep the matching database backup when delivery audit
history must also be recoverable.

## Unresolved paid designs

Keep the purchase reference when a paid design does not appear. A timeout, a
missing recovery result (404), or a generic generation failure does **not**
prove that no charge occurred. Do not repeat the purchase to test it.

Automatic recovery checks are bounded. A case marked `needs_review` remains
financially unresolved; hiding its notice does not release the purchase lock.
An authorized connection administrator can review the original attempt and
request settlement using a reason recorded in the audit history. Settlement
uses the authenticated central account and credential, not an operator's
assertion about the balance. A different connection or credential is not
evidence about the original purchase.

Only exact purchase evidence can close the case: a retained paid result, a
confirmed refund, or authoritative confirmation that no charge occurred.
Resolution must not invoke generation again. A valid retained result is
recovered rather than refunded; an ambiguous or still-running attempt remains
locked. Refund settlement, when eligible, is atomic and safe to repeat without
issuing a second credit.

Keep permanent purchase records and audit history in infrastructure backups.
Intentionally deleting a saved design retains its payment record and deletion
marker; recovery must not recreate it. Do not edit purchase rows, remove
locks, or adjust balances directly as a recovery procedure.

## Troubleshooting

- **Compose refuses to start:** run `./install.sh`; check `.env` ownership and
  permissions. Do not paste its contents into support requests.
- **Database unhealthy:** inspect disk space, volume permissions, and
  PostgreSQL health. Confirm only the Compose network can reach port 5432.
- **Setup page unavailable:** confirm both `/campaigns/` and
  `/api/campaigns/` proxy routes, matching base path, and an unconsumed setup
  token. Setup must stay disabled after owner creation.
- **Login/cookie or CSRF errors:** use one canonical HTTPS public URL and set
  trusted-proxy mode only behind your known proxy. Check clock synchronization.
- **Messages rejected/deferred:** read the provider response, verify the sender
  domain, SPF/DKIM/DMARC, suppression state, rate limits and credentials.
  Retrying permanent failures can harm reputation.
- **SES webhook returns 503:** this is intentional in the standalone release;
  no Amazon SNS signature verifier is configured, so SES webhook ingestion is
  unsupported and fails closed.
- **Hosted editor is unavailable:** no safe published hosted-editor handoff
  exists yet. Use available local template editing; never move API keys into
  the browser to work around this limitation.
- **Tracking links wrong:** correct the public URL and proxy headers before
  sending. Existing delivered messages cannot be rewritten.
- **SendRepute action denied:** verify API-key scopes, account status/balance
  and fresh price consent. Paid actions are never implied by activation.
- **Restore fails:** use the matching release and encryption key, restore to an
  empty isolated database, and review migration compatibility before cutover.

Health checks show process/database readiness only; they do not prove that a
mail provider or SendRepute is reachable.
