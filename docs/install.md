# Self-host installation

## Requirements

- A supported 64-bit host with current security updates. Linux x64/ARM64 is
  the intended Docker target; Windows should use Docker Desktop/WSL2. Native
  Windows archive behavior has not yet been confirmed.
- Docker Engine with Compose v2 for the quickstart, **or** Node.js 22 or newer
  and PostgreSQL for the alternative path.
- Persistent storage for PostgreSQL, application state, and separate backups.
- A reverse proxy with a trusted TLS certificate and DNS you control for
  internet use.
- Outbound access to the mail provider you configure. SendRepute features also
  require outbound HTTPS and a separately issued SendRepute API key.

No honest capacity number is available yet. CPU, memory, database I/O, message
size, provider limits, tracking traffic, and list shape all affect capacity.
Load-test your workload and monitor it before increasing send volume.

## Docker Compose quickstart

Download the [v0.1.1 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.1/downloads/sendrepute-campaigns-0.1.1.zip)
or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.1/downloads/sendrepute-campaigns-0.1.1.tar.gz)
and verify it against the [published SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.1/downloads/sendrepute-campaigns-0.1.1-SHA256SUMS).
These are repository downloads, not GitHub Release binary assets. GitHub's
**Code → Download ZIP** provides a repository snapshot rather than the
checksummed runtime release archive. Do not pipe a remote script into a shell.

From the extracted release:

```sh
./install.sh
docker compose up -d --build
```

`install.sh` writes a mode-0600 `.env`, generates a random PostgreSQL secret
without printing it, and creates local
operator-owned backup directories. It never downloads or executes remote
code. Compose automatically wires PostgreSQL, waits for its health check, uses
persistent named volumes, and binds Campaigns to `127.0.0.1:8080` by default.
On first start, Campaigns generates its separate file-encryption key inside
the protected application volume. There is no shared default administrator
password.

Open `http://localhost:8080/campaigns/install` on the host. On first boot, the
server creates a random setup token in its protected data directory. Retrieve
it only on the host with:

```sh
docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

This explicit command prints the secret to your terminal, unlike the installer
and normal logs; protect terminal history/capture. Use the wizard to create the
owner account, choose a strong unique password and set the public URL. The
setup transaction can succeed only once; afterward the same token cannot
create another owner. A setup token is not an administrator password.

For public use, terminate HTTPS at a reverse proxy, route both `/campaigns/`
and `/api/campaigns/` to port 8080, and set `CAMPAIGNS_TRUST_PROXY=true` in
`.env` only when the immediate upstream is your trusted reverse proxy. Enter
the canonical public URL in the setup wizard. Do not expose PostgreSQL.

## Alternative Node.js path

The release is JavaScript plus static browser assets, not a compiled
single-file binary. Install Node.js 22+, PostgreSQL, and the exact production
dependencies from the archive:

```sh
npm ci --omit=dev --ignore-scripts
export DATABASE_URL='postgresql://campaigns@localhost/campaigns'
export CAMPAIGNS_DATA_DIR='/var/lib/sendrepute-campaigns'
export CAMPAIGNS_PUBLIC_DIR="$PWD/public"
export PORT=8787
node packages/campaigns-server/dist/cli.js
```

On its first start, the server creates `credential-key` and `installer-token`
files with mode 0600 under `CAMPAIGNS_DATA_DIR`. Never copy either to a command
line or source control. Run as a dedicated unprivileged account. The server
uses only the `campaigns` PostgreSQL schema and does not require the main
SendRepute site or proprietary API-server source.

## Frontend path

The published browser build uses `/campaigns/`. The Vite frontend source is
configurable: maintainers can build assets for a different public prefix by
setting `BASE_PATH` (including leading and trailing slash) and `PORT`, for
example:

```sh
PORT=4173 BASE_PATH=/marketing/ npm run build
```

The standalone server currently mounts static assets specifically at
`/campaigns`; therefore a differently prefixed frontend also requires a server
change or a careful reverse-proxy path mapping. Rebuilding only the frontend is
not sufficient. Editing generated files is unsupported.
