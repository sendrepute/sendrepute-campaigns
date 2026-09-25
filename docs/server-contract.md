# Standalone Campaigns server contract

This documents the interface consumed by the release tooling and container.

## Package and start interface

- ESM TypeScript package named `@workspace/campaigns-server`.
- `npm run build` emits a self-contained runtime entry at `dist/cli.js` and
  declarations; runtime source is not required in a customer archive.
- `node packages/campaigns-server/dist/cli.js` starts Express and remains in
  the foreground. `DATABASE_URL` is required; an invalid/missing URL or port
  fails startup.
- Node.js 22+; no dependency on `artifacts/api-server`, main-site source,
  corpus/model files, or a Replit runtime.
- Uses `@workspace/campaigns-delivery` and `@workspace/campaigns-bridge` through
  declared runtime dependencies. All non-release dependencies use explicit
  publishable versions (no unresolved `catalog:` or non-allowlisted
  `workspace:` references).

## Configuration

Required/supported environment:

- `DATABASE_URL`
- `PORT` (default `8787`)
- `CAMPAIGNS_PUBLIC_DIR`
- `CAMPAIGNS_DATA_DIR`
- `CAMPAIGNS_TRUST_PROXY` (`true` trusts one proxy hop)
- `CAMPAIGNS_WORKER_INTERVAL_MS`

On an empty protected data directory, the server atomically creates random
`credential-key` (binary AES-256-GCM key) and `installer-token` files with mode
0600. It logs the token's path, never its value. Setup uses a database advisory
lock and can create the installation only once, so the token cannot create a
second owner even though its protected file remains for disaster diagnosis.
There are no default administrator credentials.

## HTTP behavior

- Serves the compiled SPA under the configured base (default `/campaigns/`)
  with history fallback, but never treats `/api/` as SPA content.
- Implements the same-origin API in `API-CONTRACT.md` at `/api/campaigns`.
- `GET /api/campaigns/status` waits for migration/database readiness and is the
  container health-check endpoint.
- Installation wizard route is `/campaigns/setup`; API setup accepts the
  single-use token only over the setup operation.
- Public demo reads are read-only. Authenticated mutations use secure
  HTTP-only same-site cookies, CSRF validation, role checks and audit logging.
- Provider/API secrets are encrypted at rest and never returned. Billable
  bridge operations require fresh structured consent, not a generic boolean.
- Uses only a separately owned `campaigns` PostgreSQL schema, runs
  transactional/versioned migrations, parameterizes queries, and applies
  bounded request/import limits.

The archive includes the server's `BACKUP.md` for its backup format and restore
behavior.
