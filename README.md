# SendRepute Campaigns 0.1.3

Self-hosted campaign and subscriber management. **This repository distributes a runnable compiled release, not the full source monorepo.** It includes the Campaigns browser build, server, delivery and customer-API bridge runtimes, a private bundled copy of the compiled public SendRepute customer SDK, database migrations, and operational documentation. It does **not** include the main SendRepute website, central scanner/API implementation, database contents, credentials, or a hosted-service license. Component manifests identify their respective license declarations; third-party dependencies and assets retain their own terms. Do not infer a blanket license for the hosted service or third-party assets.

![SendRepute Campaigns desktop preview](docs/assets/campaigns-github-desktop.jpg)

**[Official Campaigns demo](https://www.sendrepute.com/campaigns/?demo=true)**. [Main website Campaigns documentation](https://www.sendrepute.com/campaigns/docs).

## Download and install

Download the [v0.1.3 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.3/downloads/sendrepute-campaigns-0.1.3.zip) or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.3/downloads/sendrepute-campaigns-0.1.3.tar.gz) and verify it against the [SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.3/downloads/sendrepute-campaigns-0.1.3-SHA256SUMS). These files are versioned **repository downloads**, not GitHub Release binary assets. Alternatively, GitHub's **Code → Download ZIP** is a repository snapshot, not the checksummed runtime release archive. Do not use a ZIP containing a different version without checking its contents.

### Changes in 0.1.3

- VIP purchase pending state is persisted before the request is sent, so reloading while a purchase is still in flight preserves the uncertain-outcome lock rather than allowing a duplicate charge.
- Includes the 0.1.2 corrections, VIP consent, and catalog preview improvements.

### Changes in 0.1.2

- Corrections use the central service's exact editable-word set and independent pending state.
- VIP purchase requires a request ID and explicit price consent. An uncertain purchase remains blocked across navigation and reload instead of being retried automatically.
- Catalog previews load automatically near the viewport center, reuse cached results, and respect rate-limit cooldowns.

### Upgrade from 0.1.2

Back up PostgreSQL, application data/encryption key and your private `.env` first. Verify the archive checksum and extract into a **new directory**. Stop the old Campaigns service before starting the new one; do not run both against the same database. Copy your existing `.env` without regenerating it, and retain the same Compose project name (default `sendrepute-campaigns`) and existing `campaigns-postgres` / `campaigns-data` volumes. Preserve any custom Compose overrides and bind-mount paths. Never use `docker compose down -v`.

From the new directory run `docker compose up -d --build` with the same project/override options as the old installation. For non-Docker installations, keep the existing database URL, configuration, data directory and encryption key, install with `npm ci --omit=dev --ignore-scripts`, then restart your existing service against the new runtime. Hard-refresh the browser after upgrade. See [operations](docs/operations.md) for backup and rollback requirements. This patch requires no new npm SDK version and no Cloudflare deployment.

Requirements: Linux x64/ARM64 with Docker Engine + Compose v2 (Windows users: Docker Desktop/WSL2); or Node.js 22+ and PostgreSQL for a non-Docker installation. Native Windows archive installation is unverified. Use persistent database and application volumes, a public HTTPS reverse proxy and DNS for production delivery, and outbound access to your chosen SMTP relay/provider. [Full installation instructions](docs/install.md).

From the extracted **release archive** (or repository distribution root):

```sh
./install.sh
docker compose up -d --build
```

Open `http://localhost:8080/campaigns/install`; retrieve the one-time installer token on your own host with:

```sh
docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Keep the token private. Configure a public HTTPS URL before sending. The wizard creates the local owner and validates a SendRepute API key for activation. **Activation does not require a deposit**; local management is free. Hosted SendRepute AI, classification, and other paid services are separate: valid key, network access, available credit/entitlement and **explicit price consent** may be required. Self-hosting does not include free hosted AI operations.

Email delivery happens from your local Campaigns server to your configured SMTP relay or provider API, **not** through a central SendRepute SMTP proxy. Configure provider credentials and sender-domain SPF/DKIM/DMARC; review suppressions, unsubscribe links and one-click unsubscribe DKIM signing with an actual received message before production sending. Keep uncertain send outcomes for manual reconciliation rather than blindly retrying. [Security and deliverability](docs/security-and-deliverability.md).

Back up both PostgreSQL and the Campaigns application data/encryption key, plus your private `.env`, to protected off-host storage; periodically verify a restore. The application export alone does not preserve delivery history. [Upgrade, backup and restore procedures](docs/operations.md). Do not commit `.env`, data, token, or backups to GitHub.

## Release boundary

This distribution deliberately excludes TypeScript source maps, main-site and scanner implementation, development tests and build toolchain. Browser assets, the three Campaigns runtime packages and the public customer SDK are precompiled. The bridge installs the included SDK as a local package rather than relying on a newer registry SDK; npm installs other production dependencies from `package-lock.json`. See [standalone server contract](docs/server-contract.md). The included build and runtime do not guarantee inbox placement, provider availability, or Docker/Windows compatibility beyond tested configurations.