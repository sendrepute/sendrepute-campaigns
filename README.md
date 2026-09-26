# SendRepute Campaigns

Self-hosted campaign and subscriber management: manage audiences, campaigns, templates, automations and delivery from your own server. **This repository distributes a runnable compiled release, not the full source monorepo.** It includes the browser build, server, delivery and customer-API bridge runtimes, a bundled copy of the compiled public SendRepute customer SDK, database migrations and operational documentation. It does **not** include the main SendRepute website, central scanner/API, database contents, credentials or a hosted-service license. Component manifests identify their respective license declarations; third-party dependencies and assets retain their own terms.

![SendRepute Campaigns desktop preview](docs/assets/campaigns-github-desktop.jpg)

Try the **[interactive demo](https://www.sendrepute.com/campaigns/?demo=true)** or read the [Campaigns documentation](https://www.sendrepute.com/campaigns/docs). Demo AI and hosted builders are unavailable; the demo does not simulate a paid result.

## Download v0.1.23

Download the [v0.1.23 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.23/downloads/sendrepute-campaigns-0.1.23.zip) or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.23/downloads/sendrepute-campaigns-0.1.23.tar.gz) and verify it against the [SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.23/downloads/sendrepute-campaigns-0.1.23-SHA256SUMS). These are versioned **repository downloads**, not GitHub Release binary attachments. GitHub's **Code → Download ZIP** is a repository snapshot, not the checksummed runtime release archive. Read the [v0.1.23 release notes](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.23) for changes and migration notes.

## Install

Requirements: Linux x64/ARM64 with Docker Engine and Compose v2, or Node.js 22+ and PostgreSQL for a non-Docker installation. Windows users can use Docker Desktop/WSL2; native Windows archive installation is unverified. Use persistent database and application volumes, a public HTTPS URL for production, and outbound access to your chosen SMTP relay or provider. See the [full installation instructions](docs/install.md).

From the extracted **release archive**:

```sh
./install.sh
docker compose up -d --build
```

Open `http://localhost:8080/campaigns/install`; retrieve the one-time installer token on your own host:

```sh
docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Keep the token private. The wizard creates a local owner and validates a SendRepute API key for activation. **Activation requires no deposit; local management is free.** Optional hosted AI and classification are separate services that may require credit or entitlement and explicit price consent. Self-hosting does not include free hosted AI operations. Delivery goes from your local server to your configured SMTP relay or provider API, **not** a central SendRepute SMTP proxy. Configure provider credentials and SPF/DKIM/DMARC; test suppressions and unsubscribe links before sending. See [security and deliverability](docs/security-and-deliverability.md).

## Upgrade and backup

Back up PostgreSQL, application data/encryption key and your private `.env` first. Verify the archive checksum and extract into a **new directory**. Stop the old Campaigns service before starting the new one; do not run both against the same database. Copy your existing `.env` without regenerating it, and retain the same Compose project name (default `sendrepute-campaigns`) and existing `campaigns-postgres` / `campaigns-data` volumes. Preserve any custom Compose overrides and bind-mount paths. Never use `docker compose down -v`.

From the new directory run `docker compose up -d --build` with the same project/override options. For non-Docker installations, keep the existing database URL, configuration, data directory and encryption key, run `npm ci --omit=dev --ignore-scripts`, then restart against the new runtime. Server startup applies included database migrations. Check health before resuming schedules and hard-refresh the browser. A rollback after migration may require restoring the **matching** pre-upgrade database and data directory. The application export alone does not preserve delivery history. See [operations, backup and restore](docs/operations.md) and the [release notes](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.23). Do not commit `.env`, data, tokens or backups.

## Release boundary

This distribution deliberately excludes TypeScript source maps, main-site and scanner implementation, development tests and build toolchain. Browser assets, the three Campaigns runtime packages and the public customer SDK are precompiled. The bridge installs the included SDK as a local package rather than relying on a newer registry SDK; npm installs other production dependencies from `package-lock.json`. See [standalone server contract](docs/server-contract.md). The included build and runtime do not guarantee inbox placement, provider availability, or Docker/Windows compatibility beyond tested configurations.