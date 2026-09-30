# Security, access, consent, and deliverability

## Security baseline

Use TLS, an unprivileged service account, host firewalling, security updates,
restricted backups, centralized logs, clock synchronization, and database
credentials unique to this installation. Keep `.env`, the encryption key,
setup token, SendRepute key and provider credentials out of source control,
URLs, browser storage, screenshots, and support bundles. Rotate compromised
credentials; rotating the file-encryption key requires a supported re-encryption
procedure, not simply replacing its value.

The server stores data in a separate PostgreSQL `campaigns` schema and must use
parameterized queries, bounded imports, CSRF protection, secure HTTP-only
cookies, rate limits, audit events and encrypted provider secrets. Restrict
proxy trust to known proxy hops. Review retention and privacy obligations for
subscriber, tracking, audit, suppression and backup data.

The website's interactive demo runs only in its separate browser-local build;
it cannot send email or access the installed server. The installed frontend and
API have no demo mode or demo bootstrap. `?demo=true` and browser storage cannot
grant a session or switch an installation to simulated data. Every mutation
requires an authenticated session, CSRF validation and role permission.

## Roles

Start with least privilege. A practical separation is:

- **Owner/administrator:** users, roles, instance security, backups and
  integrations.
- **Campaign manager:** lists, templates, campaigns and scheduling.
- **Analyst/viewer:** reports and audit views without mutation.

Use separate named accounts, promptly deactivate leavers, and review role and
audit changes. Whether a built-in role has a particular permission is defined
by the installed server version; do not infer access from the role's display
name.

## Consent and the SendRepute service

Subscriber consent and SendRepute paid-operation consent are different.
Maintain lawful subscriber evidence, honor unsubscribe immediately, retain
suppression records, and use double opt-in where appropriate or required.
Purchased/scraped lists are not made safe by this software.

The SendRepute bridge is server-only and allowlists operations. Store its API
key encrypted. Free connection checks do not authorize chargeable work.
Classification, AI, builder access, VIP purchase, or other billable calls must
show current price information and obtain explicit, operation-specific consent
immediately before the call. Price changes require renewed consent. VIP is an
account/service plan, not a promise of inbox placement or unrestricted use.
The central SendRepute service remains separately operated and proprietary.

## SPF, DKIM, DMARC, and providers

For **each sending provider and sender domain**:

1. Publish the provider's exact SPF include or sending IP. Avoid multiple SPF
   records and keep DNS-lookup limits in mind.
2. Enable DKIM using that provider's selector and keys; confirm signatures
   validate and align with the visible From domain.
3. Publish DMARC with aggregate reporting. Begin with monitoring (`p=none`),
   investigate legitimate streams, then tighten policy deliberately.
4. Configure a provider-specific return path/bounce domain where supported and
   process bounces, complaints and unsubscribes.

DNS records from one provider do not automatically authenticate another.
Provider verification in the UI tests configuration/reachability, not inbox
placement. Warm sending responsibly, segment engaged recipients, cap rates,
avoid sudden volume changes, and monitor provider reputation. No software can
guarantee delivery.

## Current integration limitations

Amazon SES event ingestion requires a provider SNS topic ARN allowlist and a
manually confirmed SNS HTTPS subscription to the public provider webhook.
The server verifies the SNS signature and topic allowlist; requests without an
allowlist fail closed with HTTP 503. Configure an SES configuration-set event
destination in AWS for delivery, bounce and complaint notifications. A stored
ARN, successful connection check, or operator-marked webhook setting is not
proof of receipt: inspect the last authenticated, attributed provider event.
Continue using provider-side suppression; no endpoint guarantees inbox delivery
or automatically provisions an AWS subscription.

A hosted SendRepute editor handoff is available when the central service
supports it: the Campaigns server requests a short-lived, single-use code
bound to the authenticated key, nonce and exact return origin. Each launch
binds its own origin; the API key has no persistent origin pin. The browser
receives the one-use code, never the SendRepute API key. If the central
service lacks the handoff route, use the local editor instead; never move the
API key into browser URLs, storage, iframe messages or frontend bundles.
