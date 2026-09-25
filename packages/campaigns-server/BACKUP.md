# Portable backup design

Version 2 exports settings for inspection, non-secret business records, audience custom-field
definitions, and saved segments. Password hashes,
sessions, setup tokens, encryption keys, provider credentials, SendRepute API keys,
public action tokens, queue claims, and rate-limit state are always omitted. Restore
accepts only this bounded version, validates top-level collections, and replaces
business records in one owner-authorized transaction. Destination installation
settings (including its public URL) are preserved rather than overwritten.
Credentials must be entered again for restored providers.

Version 1 imports are rejected explicitly because they cannot represent audience
definitions safely. Subscriber scope values from a backup are never trusted and
are rebound to the destination installation's persisted singleton scope.
Migration 024 rejects duplicate subscriber email identities within a scope;
backup/restore operators should review [subscriber identity upgrade and
remediation](SUBSCRIBER-IDENTITY.md) before importing legacy data. Do not discard
subscriber IDs, consent, suppression, or delivery history to make an import pass.

Installations with approved subscriber identity reconciliations must use full
PostgreSQL backups. Application JSON export **and** restore (formats 2 and 3) are blocked
there: these formats cannot preserve historical alias IDs, immutable reconciliation
evidence, tokens and delivery/automation history. The reconciliation CLI's private
evidence JSON is not a database backup or restore input. Follow the verified
full-backup, maintenance and offline rollback procedure in
[SUBSCRIBER-IDENTITY.md](SUBSCRIBER-IDENTITY.md).

Delivery jobs and immutable delivery events are deliberately not part of version 2.
Import never deletes, rewinds, recreates, or queues delivery work and therefore can
never cause mail to be resent. A restore into an installation that already has
delivery history leaves that history intact. Restore is rejected while any queued,
sending, or unknown job remains. Worker execution and restore also share a
PostgreSQL advisory lock, so entity replacement cannot race a transport attempt.
Restore invalidates public action tokens and clears rate-limit buckets. Event-history portability will require
a new backup format version with explicit job/event referential-integrity rules;
version 2 must not be extended in place.

Immutable A/B experiment records and frozen audience assignments are not exported
in version 2. Restore into any installation containing experiments is rejected,
including completed experiments, under the same worker/restore advisory lock.
Restore into a fresh installation instead. This prevents resurrecting a reserved
campaign or replaying its audience while preserving experiment audit history.

Automation definitions, trigger events and runs are also excluded. Restore is
blocked by running or unknown automation runs, including delayed/paused waits.
Successful restore retains runtime history, pauses active definitions and
disables subscriber behavior triggers inside the restore transaction so restored
rows cannot enqueue journeys. Reactivation is explicit and revalidates step
references. Resolve ambiguous jobs with delivery reconciliation; cancel waiting
journeys before attempting restore. See AUTOMATIONS.md for lifecycle semantics.
