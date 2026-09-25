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
