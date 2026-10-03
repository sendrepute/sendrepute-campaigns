# Email checks

Campaigns automatically performs local, non-network checks when subscribers
are created or their email addresses change, including CSV imports and public
signups. Invalid ordinary syntax is rejected. Disposable and role addresses
are labelled for review, never silently deleted, unsubscribed, or suppressed.
Unusual syntax outside the supported subset is inconclusive, not proof of an
invalid mailbox. Existing opt-in and suppression protections remain unchanged.

CSV repeats of a successfully imported address are skipped. Existing contacts
are updated under the existing identity rules, never recreated or resubscribed.
Import totals include duplicates found and accepted rows flagged disposable.
The first successful row in a CSV wins; later duplicate rows do not overwrite it.

## Operations

In Operations → Email checks, choose a list and a local or DNS check. Checks
include existing subscribers regardless of subscription state. Results are
read-only observations and expire after 30 days. Operators can remove a report,
including an active operation; this cancels further work and removes its
findings, not subscribers. A separate, confirmed **Delete invalid addresses**
action on completed reports deletes up to 500 matching subscribers at a time
from all lists and cancels their queued messages. Risky/unknown results, edited
email addresses, moved contacts and currently inaccessible contacts are excluded.
Subscribers with sent, sending or unresolved messages are skipped, not deleted.
The response reports deleted, cancelled-job and skipped counts for the batch.
Deleted contacts are saved atomically in a separate Deleted subscribers list with
their original data, check reasons and deletion time. Only contacts deleted after
this feature is installed can be recovered; older hard deletions cannot be recreated.
Recovery preserves the original identity, lists and subscription state. It never
restarts cancelled jobs or enrolls automation. Missing lists and conflicting live
identities block recovery without overwriting either record. Recovery records are
independent of report deletion/expiry and included in full PostgreSQL backups,
not portable entity-only exports.
Eligible contacts are selected before protected ones so repeated batches can progress.
Each operator sees only their own reports, restricted
to currently accessible subscribers. At most five operations run per installation.

The standalone Campaigns worker processes durable batches even after the browser
closes. DNS work uses a separate scheduler from sending. Reports cover contacts
created before the operation started, using current values when each row is
examined. They are not a transactional snapshot of the whole list.

DNS checks use the system resolver, bounded timeout/retries and concurrency.
They distinguish MX, explicit null MX, implicit address-record MX, absent domains,
and temporary DNS failures. Valid domain configuration does not confirm a mailbox,
delivery, Inbox placement, or marketing consent. No SMTP probes, emails,
catch-all detection, parked-domain claims or spam-trap claims are made.

## Disposable domain data

The original CC0 dataset comes from
https://github.com/disposable-email-domains/disposable-email-domains .
The additional MIT dataset comes from https://github.com/FGRibreau/mailchecker .
Offline snapshots and their license notices ship in the release. The active list
is the deduplicated union, preserving domains unique to either source.
Pressing **Start check** attempts a conditional ETag update for each source only
when no attempt for that source has been made in the past 24 hours.
Failures also consume that daily attempt, retaining the last usable copy.
There is no scheduled source download, separate update button or source-status
card. Ordinary import and signup checks never trigger source downloads.

Each source has its own ETag, daily budget and last usable copy. A failure in one
does not stop updates to the other. A changed valid list replaces that source's
previous set, including upstream removals; domains still in the other source remain.
Data is persisted
in the installation PostgreSQL database and loaded locally; checking an email
never fetches GitHub or transmits that email. The local domain set reloads at
most once per minute across processes. Network updates have a fixed HTTPS origin,
no redirects, a ten-second deadline and a two-MiB streaming limit. No upstream
scripts run. Regular database backups retain the cache; portable entity backups
omit this public, replaceable cache and temporary operation reports.

Dataset matches include subdomains on domain boundaries, not substring matches.
This is a community-maintained indicator, not guaranteed complete or current.
Existing stored flags are observations: run another local operation after an
update to reassess existing contacts. Nothing changes sending eligibility
automatically.