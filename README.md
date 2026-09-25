# SendRepute Campaigns 0.1.1

Self-hosted campaign and subscriber management. **This repository distributes a runnable compiled release, not the full source monorepo.** It includes the Campaigns browser build, server, delivery and customer-API bridge runtimes, database migrations, and operational documentation. It does **not** include the main SendRepute website, central scanner/API implementation, database contents, credentials, or a hosted-service license. Component manifests identify their respective license declarations; third-party dependencies and assets retain their own terms. Do not infer a blanket license for the hosted service or third-party assets.

![SendRepute Campaigns desktop preview](docs/assets/campaigns-github-desktop.jpg)

**[Official Campaigns demo](https://www.sendrepute.com/campaigns/?demo=true)**. [Main website Campaigns documentation](https://www.sendrepute.com/campaigns/docs).

## Download and install

Download the [v0.1.1 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.1/downloads/sendrepute-campaigns-0.1.1.zip) or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.1/downloads/sendrepute-campaigns-0.1.1.tar.gz) and verify it against the [SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.1/downloads/sendrepute-campaigns-0.1.1-SHA256SUMS). These files are versioned **repository downloads**, not GitHub Release binary assets. Alternatively, GitHub's **Code → Download ZIP** is a repository snapshot, not the checksummed runtime release archive. Do not use a ZIP containing a different version without checking its contents.

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

This distribution deliberately excludes TypeScript source maps, main-site and scanner implementation, development tests and build toolchain. Browser assets and the three Campaigns runtime packages are precompiled; npm installs production dependencies from `package-lock.json` for the server. See [standalone server contract](docs/server-contract.md). The included build and runtime do not guarantee inbox placement, provider availability, or Docker/Windows compatibility beyond tested configurations.