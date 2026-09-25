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

The public demo is read-only. `?demo=true` and demo bootstrap responses must
never grant a session or mutate production records. Do not use demo behavior
as an authorization check; every mutation requires an authenticated session,
CSRF validation and role permission.

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

The standalone server does not currently configure an Amazon SNS signature
verifier, so Amazon SES webhook ingestion is unsupported and fails closed with
HTTP 503. Do not expose or treat that endpoint as a working bounce/complaint
processor. Until a supported verifier is released, use provider-side
suppression and process SES events through a separately verified integration.

A full hosted SendRepute editor/embed handoff is also not available. The
published API does not yet provide the required short-lived, single-use,
origin-bound handoff capability. Campaigns must not put a SendRepute API key
in a browser URL, storage, iframe message, or frontend bundle. Use the local
template editing features that are present; do not advertise a hosted editor
as enabled.
