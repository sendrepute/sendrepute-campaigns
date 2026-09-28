# SendRepute Campaigns

Self-hosted campaign and subscriber management: manage audiences, campaigns, templates, automations and delivery from your own server. **This repository distributes a runnable compiled release, not the full source monorepo.** It includes the browser build, server, delivery and customer-API bridge runtimes, a bundled copy of the compiled public SendRepute customer SDK, database migrations and operational documentation. It does **not** include the main SendRepute website, central scanner/API, database contents, credentials or a hosted-service license. Component manifests identify their respective license declarations; third-party dependencies and assets retain their own terms.

![SendRepute Campaigns desktop preview](docs/assets/campaigns-github-desktop.jpg)

Try the **[interactive demo](https://www.sendrepute.com/campaigns/?demo=true)** or read the [Campaigns documentation](https://www.sendrepute.com/campaigns/docs). Demo AI and hosted builders are unavailable; the demo does not simulate a paid result.

## Download v0.1.27

Download the [v0.1.27 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.27/downloads/sendrepute-campaigns-0.1.27.zip) or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.27/downloads/sendrepute-campaigns-0.1.27.tar.gz) and verify it against the [SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.27/downloads/sendrepute-campaigns-0.1.27-SHA256SUMS). These are versioned **repository downloads**, not GitHub Release binary attachments. GitHub's **Code → Download ZIP** is a repository snapshot, not the checksummed runtime release archive. Read the [v0.1.27 release notes](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.27) for changes and migration notes.

## Install

Requirements: Linux x64/ARM64 (Docker Engine and Compose v2; the guided setup can offer to install them on fresh Ubuntu 24.04/26.04), or Node.js 22+ and PostgreSQL for a [manual non-Docker installation](docs/install.md#alternative-nodejs-path). Windows users can use Docker Desktop/WSL2; native Windows archive installation is unverified. Use persistent database and application volumes, a public HTTPS URL for production, and outbound access to your chosen SMTP relay or provider. See the [full installation instructions](docs/install.md).

On a **fresh Ubuntu 24.04/26.04 server with no existing Campaigns installation**,
start with these commands (do not pipe a remote script into a shell):

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/sendrepute/sendrepute-campaigns.git
cd sendrepute-campaigns
./setup.sh
```

Alternatively, verify and extract the versioned release archive linked above,
then run `./setup.sh` from the extracted directory. Do **not** clone over an
existing Campaigns directory or use these fresh-install commands as an upgrade;
follow [Upgrade and backup](#upgrade-and-backup) to preserve existing data.

It reuses working non-Snap Docker Engine/Compose v2. On a fresh Ubuntu 24.04/26.04
host missing Docker, it asks before installing Ubuntu's `docker.io` and
`docker-compose-v2` packages; it stops if Snap Docker is detected rather than
automatically removing or migrating it.
The prompts configure `.env` and start Compose without manual editing or CLI
steps. Select one of:

- **Local only:** open `http://localhost:8080/campaigns/install` **on the
  server** (from a remote machine use a trusted SSH tunnel).
- **Public domain + HTTPS:** open
  `https://campaigns.example.com/campaigns/install` with **your** hostname.
  Its public DNS `A` record must point to the server; add `AAAA` only if IPv6
  works. Open inbound TCP 80/443 through firewalls/NAT and keep those ports
  available for the included Caddy/Compose `https` profile.
- **Public IP + HTTP:** open
  `http://YOUR_PUBLIC_IP:8080/campaigns/install` with **your** public IPv4
  address. You must explicitly confirm the warning and allow/forward inbound
  TCP 8080. **This is unencrypted and exposes passwords, setup token and
  sessions to interception. Do not use it as a secure production deployment.**

### Setup command cookbook

Run these **on the Ubuntu VPS, inside the cloned or extracted
`sendrepute-campaigns` directory**, not in a terminal on your laptop. The fresh
clone commands above are for a server with no existing Campaigns installation;
do not clone over an existing `.env`, database, or volumes. To choose a mode
interactively, simply run `./setup.sh`. Alternatively:

| Goal | Command on the VPS | What it does |
| --- | --- | --- |
| New HTTPS installation | `./setup.sh --mode https --host campaigns.sendrepute.com` | Starts the included Caddy HTTPS profile for **your** DNS hostname (replace the example). If Docker is missing, an interactive run asks before installing Ubuntu packages. |
| Move an existing public-IP HTTP installation to HTTPS | `./setup.sh --mode https --host campaigns.sendrepute.com` | Reviews the change, prompts for confirmation, preserves `.env` secrets and volumes, and starts Caddy. Back up first; switching exposure may briefly interrupt access. |
| Public IPv4 over unencrypted HTTP | `./setup.sh --mode http --host YOUR_PUBLIC_IP` | Requires explicit warning/consent, listens publicly on the configured backend port (default 8080). **Not secure production access.** |
| Local only | `./setup.sh --mode local` | Keeps the app on server loopback; use a trusted SSH tunnel from your own computer. |
| Resume existing configuration | `./setup.sh --mode resume` | Reuses existing settings without changing exposure. Only for an already initialized `.env`. |
| Show available flags | `./setup.sh --help` | Prints the supported command options; `-h` works too. |

`campaigns.sendrepute.com` is an **example to replace** with the exact
hostname you control; `campaign.sendrepute.com` is a **different** DNS name.
Point that exact hostname's `A` record to your VPS public IPv4; publish `AAAA`
only when IPv6 actually reaches the VPS. Allow inbound TCP 80/443 through
host/cloud firewalls and NAT and ensure nothing else owns these ports. DNS only
resolves the hostname: it does **not** forward 443 to 8080. Setup starts Caddy
for HTTPS and keeps the app backend on loopback. If Cloudflare proxies the
hostname, use **Full (strict)**, never Flexible. Test the trusted certificate
and external HTTPS reachability; local container health does not prove either.
An existing installed workspace also needs its Public URL changed in
**Workspace Settings** to `https://YOUR_HOSTNAME/campaigns/`; setup changes
Compose configuration, **not** the saved database setting. For a new owner,
enter that same URL (including `/campaigns/`) in the installation wizard.

Supported flags: `--mode local|http|https|resume` chooses the access mode;
`--host HOST` supplies a DNS hostname for HTTPS or routable public IPv4 for
HTTP (no scheme, path or port); `--accept-http` explicitly acknowledges
unencrypted HTTP in unattended use; `--confirm-change` explicitly authorizes
a change to an existing installation's exposure in unattended use;
`--install-docker` explicitly authorizes Ubuntu `docker.io` and
`docker-compose-v2` installation **only when missing** on Ubuntu 24.04/26.04;
`--wait-seconds 1..600` sets the readiness timeout (default 120 seconds);
`--help`/`-h` displays usage. In interactive use, the script requests necessary
consent instead; these flags do not silently bypass consent. It never removes
Snap Docker or disables AppArmor. For all options and troubleshooting, see the
[detailed setup commands](docs/install.md#guided-setup-command-cookbook).

In local mode, run this tunnel **on your own computer**, replacing the SSH
user/server; open `http://127.0.0.1:18080/campaigns/install` there for a
new owner, not on the VPS:

```sh
ssh -o ExitOnForwardFailure=yes -N -L 18080:127.0.0.1:8080 USER@YOUR_SERVER_HOST
```

For safe service status and bounded diagnostic logs, run these **on the VPS
in the project directory** (`sudo docker compose` if required):

```sh
docker compose --profile https ps
docker compose --profile https logs --tail=100 campaigns https postgres
```

Logs may still contain sensitive values; redact them before sharing. Never
share `.env` or the one-time owner token. Status alone does not prove the
public HTTPS certificate or external connectivity.

Public-IP HTTP works only with the **v0.1.26 (or newer) backend** and the
guided setup's explicit warning/confirmation. It enables the exact
`http://PUBLIC_IP:PORT` origin for the wizard and session cookies; simply
changing the Public URL or `.env` on a running older image cannot fix an
older server that rejects HTTP. Prefer HTTPS for real recipients.

Use the corresponding `http://localhost:8080/campaigns/`,
`https://campaigns.example.com/campaigns/` or
`http://YOUR_PUBLIC_IP:8080/campaigns/` as the wizard's Public URL, replacing
the examples with your actual host/IP. The wizard creates the owner; there is
no default administrator password. Setup does not print the one-time token.
When the app is ready, retrieve it explicitly on your own host:

```sh
docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Use `sudo docker compose exec` if required by your Docker permissions. Keep the
token private; this command prints it to your terminal. Rerunning setup must
preserve existing `.env`, secrets, data and volumes; review and confirm changes
instead of assuming a fresh install. The Caddy "active" status is not proof of
ACME issuance: check the HTTPS URL and trusted certificate from outside the
server and test public links. See [manual Docker setup and HTTPS options](docs/install.md#manual-docker-setup-advanced)
for `./install.sh` plus Compose and administrator-managed certificates.

The wizard validates a SendRepute API key for activation. **Activation requires no deposit; local management is free.** Optional hosted AI and classification are separate services that may require credit or entitlement and explicit price consent. Self-hosting does not include free hosted AI operations. Delivery goes from your local server to your configured SMTP relay or provider API, **not** a central SendRepute SMTP proxy. Configure provider credentials and SPF/DKIM/DMARC; test suppressions and unsubscribe links before sending. See [security and deliverability](docs/security-and-deliverability.md).

## Upgrade and backup

Back up PostgreSQL, application data/encryption key and your private `.env` first. Verify the archive checksum and extract into a **new directory**. Stop the old Campaigns service before starting the new one; do not run both against the same database. Copy your existing `.env` without regenerating it, and retain the same Compose project name (default `sendrepute-campaigns`) and existing `campaigns-postgres` / `campaigns-data` volumes. Preserve any custom Compose overrides and bind-mount paths. Never use `docker compose down -v`.

For an existing Git clone, back up first, inspect local edits with `git status --short`, then run `git pull --ff-only` from that repository directory. If pull refuses due to local changes (especially a custom `compose.yaml`), preserve and reconcile them manually; do not force-reset or overwrite private `.env` or volumes. Run `./setup.sh --mode resume` to rebuild and retain the existing access mode; choose `--mode https --host YOUR_HOSTNAME` only when intentionally changing exposure, confirming the prompt (or add `--confirm-change` for unattended operation). For a deliberate HTTP-IP setup, `./setup.sh --mode http --host YOUR_PUBLIC_IP` requires explicit unencrypted-HTTP consent; unattended use also requires `--accept-http` and, if changing existing exposure, `--confirm-change`. Review firewall exposure first.

From a new extracted archive with the same project and copied private `.env`, use guided setup to opt in to Public HTTP, or run `docker compose up -d --build` with the same project/override options for unchanged network modes. For non-Docker installations, keep the existing database URL, configuration, data directory and encryption key, run `npm ci --omit=dev --ignore-scripts`, then restart against the new runtime. Server startup applies included database migrations. Check health before resuming schedules and hard-refresh the browser. A rollback after migration may require restoring the **matching** pre-upgrade database and data directory. The application export alone does not preserve delivery history. See [operations, backup and restore](docs/operations.md) and the [release notes](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.27). Do not commit `.env`, data, tokens or backups.

## Release boundary

This distribution deliberately excludes TypeScript source maps, main-site and scanner implementation, development tests and build toolchain. Browser assets, the three Campaigns runtime packages and the public customer SDK are precompiled. The bridge installs the included SDK as a local package rather than relying on a newer registry SDK; npm installs other production dependencies from `package-lock.json`. See [standalone server contract](docs/server-contract.md). The included build and runtime do not guarantee inbox placement, provider availability, or Docker/Windows compatibility beyond tested configurations.