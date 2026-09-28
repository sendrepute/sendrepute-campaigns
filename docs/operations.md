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

Read the release notes, then take and verify a
[full infrastructure backup](#docker-infrastructure-backup) before updating.
Keep the old release and encryption key available for rollback. On the VPS,
from the **existing Git clone**, inspect local edits and then run:

```sh
git status --short
git pull --ff-only && ./setup.sh --mode resume
```

If pull refuses, preserve and reconcile local changes; never force-reset
`.env` or custom Compose files. `--mode resume` retains the existing exposure,
including HTTPS. For an archive upgrade, verify its published SHA-256 checksum,
extract into a new directory, carry over the same private `.env`, Compose
project, overrides and volumes, stop the old application before starting the
new one, and resume setup there. Do not run both versions against one database
or use `docker compose down -v`. Check the health endpoint, login, provider
verification and public links before resuming schedules; test sends require
separate operator authorization.

Never run two application versions against the same database during migration.
Database migrations may make application rollback impossible without restoring
the matching pre-upgrade database **and** data directory.

## Backup and restore

These commands apply to the **bundled Docker Compose installation** in
`compose.yaml`, run on the VPS from its existing project directory. They do
not cover custom external databases, bind mounts or separately deployed
workers: inventory and stop every writer, and back up those paths separately.
The Campaigns web process also runs its delivery worker; stopping only the
proxy is insufficient. These backups include the full `campaigns` PostgreSQL
database (business records, delivery jobs/events, automations and paid
idempotency/audit state), the application data/encryption key, HTTPS site
materials, and, if Caddy has a container, its certificate/configuration
volumes. They are **not automatically encrypted**.

### Docker infrastructure backup

Schedule downtime. Pause new traffic and sending; finish or reconcile
in-flight/unknown delivery outcomes **before** stopping writers. Check for
additional worker processes or external integrations and stop them too. Use
your usual `sudo docker` prefix if necessary, consistently in every command.
Do not run this in a new clone or against a different Compose project.
The `busybox:1.37` image is the one used by this Compose file's site-init
service; Docker may need to fetch it if not already present. Ensure the
backup disk has enough space. This block **stops Campaigns and HTTPS** but
keeps PostgreSQL running for `pg_dump`; if a command fails, leave services
stopped and investigate rather than assuming the backup completed.

```sh
cd /path/to/existing/sendrepute-campaigns
set -eu
umask 077
BACKUP_DIR="$PWD/../campaigns-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
RUNNING="$(docker compose --profile https ps --status running --services)"
printf '%s\n' "$RUNNING" > "$BACKUP_DIR/running-services.txt"
docker compose --profile https stop https campaigns
APP_CID="$(docker compose --profile https ps -a -q campaigns)"
test -n "$APP_CID"
DATA_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/sendrepute-campaigns"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
SITE_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/sendrepute-campaigns/https-site"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
test -n "$DATA_VOL" && test -n "$SITE_VOL"
printf '%s\n' "campaigns-data=$DATA_VOL" "campaigns-https-site=$SITE_VOL" > "$BACKUP_DIR/volumes.txt"
cp -p .env compose.yaml Caddyfile start-https.sh Dockerfile "$BACKUP_DIR/"
chmod 600 "$BACKUP_DIR"/.env "$BACKUP_DIR"/compose.yaml "$BACKUP_DIR"/Caddyfile "$BACKUP_DIR"/start-https.sh "$BACKUP_DIR"/Dockerfile
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$BACKUP_DIR/postgres.dump"
save_volume() {
  docker volume inspect "$2" >/dev/null
  docker run --rm --network none \
    --mount "type=volume,src=$2,dst=/source,readonly" \
    --mount "type=bind,src=$BACKUP_DIR,dst=/backup" \
    busybox:1.37 sh -ec "umask 077; cd /source; tar -cf /backup/$1.tar ."
}
save_volume campaigns-data "$DATA_VOL"
save_volume campaigns-https-site "$SITE_VOL"
HTTPS_CID="$(docker compose --profile https ps -a -q https)"
if test -n "$HTTPS_CID"; then
  CADDY_DATA_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$HTTPS_CID")"
  CADDY_CONFIG_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' "$HTTPS_CID")"
  test -n "$CADDY_DATA_VOL" && test -n "$CADDY_CONFIG_VOL"
  printf '%s\n' "campaigns-caddy-data=$CADDY_DATA_VOL" "campaigns-caddy-config=$CADDY_CONFIG_VOL" >> "$BACKUP_DIR/volumes.txt"
  save_volume campaigns-caddy-data "$CADDY_DATA_VOL"
  save_volume campaigns-caddy-config "$CADDY_CONFIG_VOL"
fi
(cd "$BACKUP_DIR" && sha256sum .env compose.yaml Caddyfile start-https.sh Dockerfile running-services.txt volumes.txt postgres.dump *.tar > SHA256SUMS && sha256sum -c SHA256SUMS)
if printf '%s\n' "$RUNNING" | grep -Fx campaigns >/dev/null; then docker compose --profile https up -d campaigns; fi
if printf '%s\n' "$RUNNING" | grep -Fx https >/dev/null; then docker compose --profile https up -d https; fi
```

Do not paste secrets or logs into support messages. The backup directory
is created with mode 0700 and its new files with mode 0600; make separately
encrypted, access-controlled off-host copies and keep multiple generations.
Preserve any custom Compose overrides, bind mounts and the exact release
tag/commit separately with the backup. Verify checksums after transfer and
periodically rehearse a restore on an isolated host. Stopping the app avoids
new database writes while the dump and volume archives are taken; PostgreSQL
remains available for the consistent custom-format dump.

### Restore to an empty isolated installation

**Do not point this at a live instance or nonempty volumes.** Restoring a
snapshot replaces its database/business and job state, discards newer writes,
and may cause queued mail or automations to run again. First take a *fresh*
full backup of the current installation, block provider/API/SMTP egress, stop
every writer (including other hosts), and reconcile accepted/unknown
delivery jobs with the provider before any restart. Use a trusted backup
from the same installation and the matching release (or a documented
compatible version); never mix `.env`, database and data archives from
different points in time. The restored encryption key is in
`campaigns-data.tar`. Do not try to fix a mismatch by resetting it.

On a **new, isolated host/Compose project with empty volumes**, extract the
matching release without installing/starting Campaigns. Set `BACKUP_DIR` to
the absolute directory containing the verified backup files (transfer them
securely); work inside that release directory. Review backed-up `compose.yaml`
and any overrides without printing `.env`. Use the same Compose configuration
and project identity as the backup on this isolated host; if its volumes or
containers already exist, **stop** and investigate rather than overwriting
them. This block creates containers without starting Campaigns/HTTPS,
requires every restored volume to be empty, and starts only PostgreSQL:

```sh
cd /path/to/matching/sendrepute-campaigns-release
set -eu
umask 077
BACKUP_DIR=/absolute/private/path/to/campaigns-backup-YYYYMMDDTHHMMSSZ
test -f "$BACKUP_DIR/SHA256SUMS" && test ! -e .env
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
tar -tf "$BACKUP_DIR/campaigns-data.tar" >/dev/null
tar -tf "$BACKUP_DIR/campaigns-https-site.tar" >/dev/null
if grep -q '^campaigns-caddy-data=' "$BACKUP_DIR/volumes.txt"; then
  test -f "$BACKUP_DIR/campaigns-caddy-data.tar" && test -f "$BACKUP_DIR/campaigns-caddy-config.tar"
  tar -tf "$BACKUP_DIR/campaigns-caddy-data.tar" >/dev/null
  tar -tf "$BACKUP_DIR/campaigns-caddy-config.tar" >/dev/null
fi
cp -p "$BACKUP_DIR/.env" .env
docker compose --profile https build campaigns
docker compose --profile https create --no-build
APP_CID="$(docker compose --profile https ps -a -q campaigns)"
HTTPS_CID="$(docker compose --profile https ps -a -q https)"
test -n "$APP_CID" && test -n "$HTTPS_CID"
DATA_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/sendrepute-campaigns"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
SITE_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/sendrepute-campaigns/https-site"}}{{.Name}}{{end}}{{end}}' "$APP_CID")"
CADDY_DATA_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$HTTPS_CID")"
CADDY_CONFIG_VOL="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' "$HTTPS_CID")"
test -n "$DATA_VOL" && test -n "$SITE_VOL" && test -n "$CADDY_DATA_VOL" && test -n "$CADDY_CONFIG_VOL"
grep -Fx "campaigns-data=$DATA_VOL" "$BACKUP_DIR/volumes.txt" >/dev/null
grep -Fx "campaigns-https-site=$SITE_VOL" "$BACKUP_DIR/volumes.txt" >/dev/null
if grep -q '^campaigns-caddy-data=' "$BACKUP_DIR/volumes.txt"; then
  grep -Fx "campaigns-caddy-data=$CADDY_DATA_VOL" "$BACKUP_DIR/volumes.txt" >/dev/null
  grep -Fx "campaigns-caddy-config=$CADDY_CONFIG_VOL" "$BACKUP_DIR/volumes.txt" >/dev/null
fi
restore_volume() {
  docker volume inspect "$2" >/dev/null
  docker run --rm --network none \
    --mount "type=volume,src=$2,dst=/target" \
    --mount "type=bind,src=$BACKUP_DIR,dst=/backup,readonly" \
    busybox:1.37 sh -ec '[ -z "$(ls -A /target)" ] && cd /target && tar -xf "/backup/$1.tar"'
}
restore_volume campaigns-data "$DATA_VOL"
restore_volume campaigns-https-site "$SITE_VOL"
if test -f "$BACKUP_DIR/campaigns-caddy-data.tar" && test -f "$BACKUP_DIR/campaigns-caddy-config.tar"; then
  restore_volume campaigns-caddy-data "$CADDY_DATA_VOL"
  restore_volume campaigns-caddy-config "$CADDY_CONFIG_VOL"
fi
docker compose --profile https up -d postgres
docker compose exec -T postgres sh -c 'exec pg_restore -l' < "$BACKUP_DIR/postgres.dump" >/dev/null
docker compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error' < "$BACKUP_DIR/postgres.dump"
docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT state, count(*) FROM campaigns.jobs
WHERE state IN ('queued','sending','unknown')
GROUP BY state ORDER BY state;
SQL
```

The restore aborts if a target volume contains files, rather than deleting
them. If the backup records Caddy volumes but either archive is missing,
**stop** and recover the matching pair; on an installation that never had a
Caddy container, they may both be absent. Check restoration and delivery
history while outbound mail remains blocked. The last query is an inventory,
**not** permission to replay queued/sending/unknown jobs. Reconcile provider
acceptance and ambiguous outcomes, review schedules and automation triggers,
and approve each resumption deliberately; never retry an unknown outcome
blindly. Only after a safe cutover, unblock the selected outbound routes and
start Campaigns; start HTTPS only if it ran before backup:

```sh
if grep -Fx campaigns "$BACKUP_DIR/running-services.txt" >/dev/null; then docker compose --profile https up -d campaigns; fi
if grep -Fx https "$BACKUP_DIR/running-services.txt" >/dev/null; then docker compose --profile https up -d https; fi
```

Keep the old host offline to prevent two workers sharing one sending identity.
Verify HTTPS certificates externally, login, public links, provider
configuration and database history before restoring normal traffic. If the
restore or review fails, leave Campaigns/HTTPS stopped and egress blocked.

An in-app Campaigns export is useful for logical portability but is **not**
a disaster-recovery backup: it omits queue claims, delivery jobs/events,
credentials, tokens and other runtime state. PostgreSQL, application files,
secrets, release version and configuration must correspond. Restoring the
database without the original encryption key makes encrypted provider
credentials unrecoverable.

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
