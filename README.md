# SendRepute Campaigns

Self-hosted audiences, campaigns, templates, automations and delivery from your
own server. This repository distributes the **compiled runtime**, not the full
source monorepo.

![SendRepute Campaigns desktop preview](docs/assets/campaigns-github-desktop.jpg)

Try the [interactive demo](https://www.sendrepute.com/campaigns/?demo=true)
(no real messages, hosted builders or paid results).

## Quickstart: fresh Ubuntu 24.04/26.04

On a **new server without an existing Campaigns installation**, run:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/sendrepute/sendrepute-campaigns.git
cd sendrepute-campaigns
./setup.sh
```

Setup asks which access mode to use and reuses working Docker/Compose; on a
fresh supported Ubuntu server without Docker, it requests consent to install
Ubuntu's packages. It does not remove Snap Docker or bypass AppArmor. Do not
clone over an existing installation; see [Upgrade and backup](#upgrade-and-backup).

For a new owner, follow the URL printed by setup and enter the corresponding
Public URL ending in `/campaigns/`. Setup does **not** print the one-time owner
token; retrieve it only when needed on the VPS with
`docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token`
(`sudo docker compose` if required). Keep the token, `.env` and logs private.

## Choose access

- **HTTPS domain (recommended):** setup starts the included Caddy proxy.
  Point the hostname's DNS `A` record to the VPS, allow TCP 80/443 and check
  the trusted certificate externally. Use `AAAA` only with working IPv6.
- **Local / SSH tunnel:** binds the app to VPS loopback. Open it through a
  trusted SSH tunnel from your computer; your laptop's `localhost` is not
  the VPS.
- **Public IP + HTTP:** explicitly consent to unencrypted access on port 8080.
  Passwords, tokens and sessions can be intercepted; **not for secure
  production deployment**.

See the [setup command cookbook](docs/install.md#guided-setup-command-cookbook)
for exact commands, options, local SSH tunneling, diagnostics and warnings.

## Moving from HTTP to HTTPS

Back up first. Point **your actual hostname** to the VPS, free/open TCP 80/443
and confirm its DNS works. On the VPS, in the **existing** project directory:

```sh
./setup.sh --mode https --host campaigns.sendrepute.com
```

Replace `campaigns.sendrepute.com` with your hostname (`campaign` and
`campaigns` are different DNS names). Confirm the exposure change when asked;
setup starts Caddy but does not rewrite the installed workspace's saved Public
URL. After verifying HTTPS externally, change that URL in **Workspace
Settings** to `https://YOUR_HOSTNAME/campaigns/`. If using Cloudflare, use
**Full (strict)**, never Flexible. See the
[migration steps](docs/install.md#migrate-an-installed-public-ip-http-workspace-to-https)
before changing a live installation.

## Download v0.1.28

Prefer a versioned archive? Download the [ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.28/downloads/sendrepute-campaigns-0.1.28.zip)
or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.28/downloads/sendrepute-campaigns-0.1.28.tar.gz),
verify the [SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.28/downloads/sendrepute-campaigns-0.1.28-SHA256SUMS),
extract, and run `./setup.sh` there. These are repository downloads, **not**
GitHub Release binary attachments; **Code → Download ZIP** is a different
snapshot. See the [v0.1.28 release notes](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.28).

## Upgrade and backup

Back up the database, application data/encryption key and private `.env`
**before** upgrading; preserve the Compose project name and volumes. In an
existing Git clone, inspect local changes, then use `git pull --ff-only` and
`./setup.sh --mode resume` to retain the current exposure. If pull refuses,
reconcile edits rather than force-resetting. For an archive upgrade, verify and
extract to a **new directory**, carry over the same private configuration and
volumes, and stop the old service before starting the new one. **Never run
`docker compose down -v` against real data.** Changes to exposure may briefly
interrupt access. Follow [upgrade and restore instructions](docs/operations.md#upgrade).

## More information

- [Installation and setup commands](docs/install.md) — all flags, HTTPS/HTTP,
  manual Docker or Node.js paths, token and troubleshooting.
- [Operations, backup and restore](docs/operations.md) — upgrades and recovery.
- [Security and deliverability](docs/security-and-deliverability.md) — SMTP,
  SPF/DKIM/DMARC, consent and production checks.
- [Standalone server contract](docs/server-contract.md) — integration details.

Activation validates a separately issued SendRepute API key; **no deposit is
required for activation**, and local management is free. Optional hosted AI
and classification require their own entitlement or credit and explicit price
consent; demo AI does not perform paid results. Delivery goes from **your
server to your configured SMTP relay/provider**, not a central SendRepute
SMTP proxy.

## Release boundary

The release includes the compiled browser, server, delivery and customer-API
bridge, public customer SDK, migrations and docs. It excludes the main
SendRepute site and scanner, database contents, secrets, source maps, tests
and development toolchain. Component and third-party license terms still
apply; self-hosting grants no hosted-service license or inbox-placement
guarantee.