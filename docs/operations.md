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

Workspace Settings checks the latest stable GitHub release for administrators.
When an official release archive and matching SHA-256 checksum asset are
published, an update notice shows the documented manual server command for
existing Git clones. It does not download or install software or restart Docker. If the
installed archive predates embedded version metadata, the check cannot prove
whether an upgrade is needed; use your deployment records instead. A GitHub
failure or a release without official archive/checksum assets is reported as
unavailable, not as "up to date." Publish archives and checksum assets as part
of the separate release workflow; the check does not publish releases.

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

### Opt-in encrypted scheduled backups

The distributed `backup.sh` is **disabled until explicitly configured and
scheduled**. It covers the bundled Compose installation only: full PostgreSQL
custom dump, application data volume (including original encryption key),
HTTPS site, optional Caddy volumes, `.env`, Compose and runtime configuration.
It stops the entire Campaigns process/worker and HTTPS, keeps PostgreSQL up,
then retries restoration of only services that were running beforehand, even
after ordinary errors and INT/TERM. It checks that Campaigns becomes healthy
and HTTPS is running. If either does not recover within the bounded retries,
`status` reports `service_recovery_failed` (and whether the archive completed);
alert and repair service availability manually. No process can guarantee
recovery after SIGKILL, host loss or Docker failure.
It refuses if any sending or unknown delivery job exists before or after
stopping the worker. Investigate ambiguous provider acceptance rather than
retrying messages; queued jobs are not automatically resent by this tool.
It cannot discover other hosts, external workers, custom bind mounts or
external databases: **do not enable it** for such deployments without a
separate coordinated writer shutdown and backup plan. Schedule a maintenance
window; app/HTTPS traffic pauses during backup. Never run it against a
different Compose project or new checkout.

On the existing VPS as the dedicated Compose operator (who must be able to
use Docker), install `age`, `age-keygen`, `docker`, Compose v2, `sftp`, `flock`,
`sha256sum`, `tar` and standard coreutils. Docker access is effectively root
access. Provision an off-host mounted filesystem or a dedicated restricted
SFTP account with a pre-existing private destination directory and pinned
SSH host key. A local directory on the same machine is **not** off-host.
Keep an independently secured key copy on a separate recovery host; losing
the age identity makes archives unreadable. Do not put keys in `.env`,
command arguments, logs, tickets or public repositories.

```sh
umask 077
mkdir -m 700 -p /private/campaigns-backups
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /etc/sendrepute-campaigns
sudo install -m 600 -o "$(id -un)" -g "$(id -gn)" backup.conf.example /etc/sendrepute-campaigns/backup.conf

# Leave AGE_RECIPIENT and AGE_IDENTITY blank for automatic key creation.
# Leave AGE_RECIPIENT and AGE_IDENTITY blank for automatic key creation.
# and exactly one OFFHOST_LOCAL_DIR or OFFHOST_SFTP_HOST/USER/DIR.
# For SFTP, optionally set SSH_IDENTITY (private mode 0600).
./backup.sh backup
./backup.sh status
./backup.sh verify /private/campaigns-backups/EXACT-ARCHIVE-NAME.tar.age
```

The first interactive `backup` creates a recovery file automatically and
shows its **path only**, never its contents. Save a copy on your recovery
device, separate from the server and encrypted backup destination, then
confirm the prompt. The script remembers the confirmation and reuses the
same key for later backups. It does not stop services before this confirmation.
Scheduled/noninteractive runs cannot acknowledge custody on your behalf.
Existing installations with both age settings filled continue using their
existing keys.

With the default configuration path, the recovery file is
`/etc/sendrepute-campaigns/backup.conf.keys/identity`. A custom absolute
`CAMPAIGNS_BACKUP_CONFIG` uses its own sibling `<config>.keys/identity`.
The configuration directory must be operator-owned, mode 0700 and free of
symlink aliases; the key directory must remain separate from installation,
local spool and off-host destination paths. Preserve this state across upgrades.
The confirmation phrase is `I SAVED THE RECOVERY FILE`. Refusing or
interrupting the prompt keeps the same generated key for the next attempt.
Missing or inconsistent previously created key state fails closed rather
than silently replacing the key needed by old archives.

The host retains a protected identity because every backup is decrypted
locally for integrity verification before publication. This is not an
offline-only key design: someone with full control of the host can decrypt
its backups. Your independent recovery copy protects against host/key loss;
do not include it in `.env`, an application volume, or the archive destination.
Old unencrypted backups are not converted by this setup.

Use a path **outside the project** for the 0700 local spool. Config must be
owned by the invoking operator with mode 0600/0400; identity likewise.
`./backup.sh status` needs only that private config and the operator-owned
0700 local spool with a regular, operator-owned 0600/0400 status file; it does
not require the age identity or backup tools. Missing or insecure paths still
cause status to fail. Backup, verify and extract retain their full preflight.
For mounted destinations the existing off-host directory must be mode 0700.
It must also be owned by the invoking operator and support atomic hard links:
the script first writes a private temporary encrypted file, compares bytes,
and publishes without overwriting any existing name (including dangling
symlinks). A destination without this filesystem property fails closed.
SFTP paths are restricted to absolute simple ASCII paths without `..`;
SSH uses batch mode and strict host-key checking; no remote shell or
interpolated command is executed. Give the SFTP account write/read access
only to the destination, and monitor remote capacity. Backups require space
for plaintext *temporary staging* (mode 0700) plus encrypted local archive;
the script removes staging on exit. Use an encrypted host disk if plaintext
swap/crash recovery is a concern. The remote encrypted bytes are read back
and compared. No existing archive is deleted or rotated automatically;
after independent recovery testing, manage retention only for these owned,
verified archives and never delete pre-existing backups without authorization.

To schedule **only after a successful manual run**, copy `backup.service.example`
and `backup.timer.example` to `/etc/systemd/system/sendrepute-campaigns-backup.service`
and `.timer`. Replace `REPLACE_OPERATOR` and
`REPLACE_ABSOLUTE_INSTALL_DIRECTORY` in the service with the actual user and
installed directory, inspect with `systemd-analyze verify`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sendrepute-campaigns-backup.timer
systemctl list-timers sendrepute-campaigns-backup.timer
./backup.sh status
```

To disable: `sudo systemctl disable --now sendrepute-campaigns-backup.timer`.
The timer does not run automatically on boot to catch up missed runs. Status
shows last attempt, success timestamp and archive even after a later failure.
Failures also emit a non-secret syslog message via `logger`; route syslog alerts
through your existing monitoring and alert on stale last success. No paid AI
or external notification endpoint is used. If status indicates failure, check
disk/remote access, services, unknown jobs and operator-owned status; do not
assume a failed backup is recoverable.

`./backup.sh verify /absolute/path/archive.tar.age` independently decrypts
to private temporary storage, checks tar and SHA-256 manifest and runs
`pg_restore -l` in the pinned Postgres image, without writing to a database
or starting Campaigns. It also checks every nested volume tar member: absolute
paths, parent traversal, symlinks, hardlinks and special files fail closed;
if an existing legitimate app/Caddy volume contains links, investigate and
plan a separate manual verified recovery rather than bypassing validation.
Age recipient encryption does not prove *who* created a backup; accept only
archives from the operator-controlled storage and compare out-of-band archive
fingerprints when transferring untrusted copies. For a recovery rehearsal,
`./backup.sh extract /absolute/path/archive.tar.age /absolute/empty/private/dir`
requires an existing empty mode-0700 directory and only extracts verified
files. The **destructive** restore is deliberately not automated. Use the
matching release on an isolated empty installation, block outbound email,
and follow [restore to an empty isolated installation](#restore-to-an-empty-isolated-installation)
using the extracted directory as `BACKUP_DIR`. Do not start the worker until
queued/sending/unknown outcomes are reconciled; restoring old state can
otherwise repeat sends and other side effects.

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

## Templates page tabs

The Templates page (`/templates`) has three tabs, in this order:

1. **Saved Library** (default). Your authored designs: search, paging, the
   paid-design recovery notice, edit and delete. Opening the page loads only the
   saved list and the connection status; no Standard or VIP catalog request is
   made until you choose one of those tabs.
2. **Standard**. The 20 free Standard designs, the Blank canvas card and the AI
   Template card. There is no separate "New Design" or "Open blank" button; the
   Blank canvas card is the only blank entry point. The legacy
   `/templates#design-gallery` link (and `#standard`) opens this tab. The
   selected tab is mirrored in the URL hash (`#standard`, `#vip`; none for Saved),
   so following a tab link on the same page switches tabs.
3. **VIP**. Shown only after the connection status has loaded and reports an
   active, unexpired VIP entitlement for the current connected key. It is never
   shown while the status is loading. If the entitlement is lost or expires while
   VIP is selected, the page returns to Saved Library. The Blank canvas card
   (quoted before payment) and VIP AI card stay in this tab. Hiding the tab is a
   convenience only; the server still enforces VIP access on every request.

While the chosen catalog list is loading, that tab shows small placeholder cards
next to its Blank canvas and AI cards (no page-wide overlay). A catalog already
cached for the current connection appears immediately; a load error replaces the
placeholders with the error and Retry, so they never spin indefinitely.

Only the chosen designer's catalog is mounted, so Standard and VIP never issue
requests or show busy states for each other. A free catalog design returned from
the editor continues to the unsaved new-template editor; a paid design already
saved on the server opens its Saved Library entry. The browser-local demo uses
the same tab rules with its synthetic VIP entitlement, but does not run hosted
builders, blank canvases, catalog imports, AI or paid analysis. It never sends
real mail or charges the connected wallet.

The Standard hosted editor works with MJML: its 20 catalog designs and blank
canvas are free, while Standard AI generation is separately quoted and paid.
VIP is a proprietary native document, **not MJML**. Active VIP membership alone
does not include native builder access or AI generation. Native catalog/blank
access and VIP AI generation each require their own displayed price and explicit
consent. Both paid AI modes create an owned Saved Library design; free compilation
or reopening its source is not a second paid generation. If a paid result is
interrupted, recover that owned entry instead of placing another order. A normal
hosted-editor return only populates the current draft; saving it does not send
mail or automatically create a reusable template.

In campaign Review, paid content analysis is separate from paid Rewrite All.
Rewrite All requires an owned paid analysis receipt (not a free preview), a
free quote and explicit consent before a wallet debit. The returned draft must
be inspected; classifier results do not guarantee inbox placement. Do not
repeat a paid request when its outcome is uncertain; recover the original
receipt first. Self-hosted Campaigns can send through the configured provider;
the browser-local demo cannot send.

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
- **SES webhook returns 503:** configure and save an SNS topic ARN allowlist in
  the SES provider metadata. Configure SES configuration-set events to publish
  to that SNS topic, subscribe the public HTTPS webhook URL, and confirm the
  signed SNS subscription manually in AWS. SNS signatures and topic allowlists
  are checked by the server. A saved ARN or provider connection check does not
  confirm that events are arriving; check the last attributed webhook event in
  Provider analytics after an authorized test. No test email is sent automatically.
- **Hosted editor is unavailable:** check that the central service supports
  one-use hosted handoffs, the installation Public URL has the correct origin,
  and the API key includes `builder:write` (plus `vip:builder` for VIP mode).
  Use local template editing if the central service does not offer the route;
  never move API keys into the browser.
- **Tracking links wrong:** correct the public URL and proxy headers before
  sending. Existing delivered messages cannot be rewritten.
- **SendRepute action denied:** verify API-key scopes, account status/balance
  and fresh price consent. Paid actions are never implied by activation.
- **Restore fails:** use the matching release and encryption key, restore to an
  empty isolated database, and review migration compatibility before cutover.

Health checks show process/database readiness only; they do not prove that a
mail provider or SendRepute is reachable.

# Edit config privately: LOCAL_DIR,
