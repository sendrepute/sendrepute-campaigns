# Self-host installation

## Requirements

- A supported 64-bit host with current security updates. Linux x64/ARM64 is
  the intended Docker target; Windows should use Docker Desktop/WSL2. Native
  Windows archive behavior has not yet been confirmed.
- Docker Engine with Compose v2 for the Docker path (the guided setup can offer
  to install both on fresh Ubuntu 24.04/26.04), **or** Node.js 22 or newer and
  PostgreSQL for the alternative path.
- Persistent storage for PostgreSQL, application state, and separate backups.
- A public hostname, working DNS and a trusted TLS certificate for production
  internet use. The guided setup can start the included Caddy proxy.
- Outbound access to the mail provider you configure. SendRepute features also
  require outbound HTTPS and a separately issued SendRepute API key.

No honest capacity number is available yet. CPU, memory, database I/O, message
size, provider limits, tracking traffic, and list shape all affect capacity.
Load-test your workload and monitor it before increasing send volume.

## Guided Docker quickstart

On a **fresh Ubuntu 24.04/26.04 server without an existing Campaigns
installation**, start with these commands. The guided setup handles Docker
installation with your consent if Docker is missing:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/sendrepute/sendrepute-campaigns.git
cd sendrepute-campaigns
./setup.sh
```

Do **not** clone over an existing Campaigns installation or use this
fresh-install sequence for an upgrade. Back up `.env`, the database and
application volumes, and follow the [upgrade instructions](operations.md)
instead. For an existing Git clone, inspect local edits and use
`git pull --ff-only` as described in the [repository README](https://github.com/sendrepute/sendrepute-campaigns#upgrade-and-backup);
never force-reset private settings or delete volumes.

Alternatively, use a versioned release archive:

Download the [v0.1.26 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.26/downloads/sendrepute-campaigns-0.1.26.zip)
or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.26/downloads/sendrepute-campaigns-0.1.26.tar.gz)
and verify it against the [published SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.26/downloads/sendrepute-campaigns-0.1.26-SHA256SUMS).
These are repository downloads, not GitHub Release binary assets. GitHub's
**Code → Download ZIP** provides a repository snapshot rather than the
checksummed runtime release archive. Do not pipe a remote script into a shell.

From the extracted release archive **or repository directory**, run:

```sh
./setup.sh
```

Follow the prompts; no `.env` editing or separate Compose command is needed
for the guided path. If a non-Snap Docker Engine and Compose v2 already work,
setup reuses them without replacing them. On a fresh Ubuntu 24.04/26.04 host missing Docker,
it asks for consent before installing Ubuntu's `docker.io` and
`docker-compose-v2` packages. It stops on detecting Snap Docker; it does not
automatically remove or migrate Snap Docker. If an existing installation does
not work, investigate it rather than assuming it is safe to replace.

The guided network choice determines the address to open:

| Choice | Installation address | Before choosing |
| --- | --- | --- |
| Local only | `http://localhost:8080/campaigns/install` **on the server** | The app listens on host loopback. For access from another computer, use a trusted SSH tunnel or configure a trusted reverse proxy. `localhost` on your laptop is not the remote server. |
| Public domain + HTTPS | `https://campaigns.example.com/campaigns/install` (replace with **your** hostname) | Point its public `A` record to this server; publish `AAAA` only if IPv6 reaches it. Allow inbound TCP 80/443 through host/cloud firewalls and forward them through NAT if needed. Nothing else may own those ports. Setup starts the included Compose `https` profile/Caddy, which can request a certificate only when public DNS and ACME reach the host. |
| Public IP + HTTP | `http://YOUR_PUBLIC_IP:8080/campaigns/install` (replace with **your** public IPv4 address) | This exposes the application over **unencrypted HTTP** and requires an explicit warning/confirmation. Allow inbound TCP 8080 through host/cloud firewalls and forward it through NAT if needed. Passwords, setup token and sessions can be intercepted on an untrusted network; do **not** treat this as a secure production deployment. Prefer public domain + HTTPS. |

Use the corresponding `http://localhost:8080/campaigns/`,
`https://campaigns.example.com/campaigns/`, or
`http://YOUR_PUBLIC_IP:8080/campaigns/` as the Public URL in the installation
wizard (replace example host/IP with the one you chose). Public IP over HTTP is
not a substitute for trusted TLS when sending links to real recipients. There
is an explicit exact-origin HTTP opt-in in the v0.1.26 backend and guided
setup; an older backend will still reject an HTTP Public URL even if you edit
`.env` or enter the URL in the wizard. Upgrade and rebuild the backend, then
select Public IP + HTTP and confirm its warnings. This opt-in permits only the
selected public IPv4 address and port for installation and session cookies,
not arbitrary insecure origins. The Public URL must end in `/campaigns/`.
There is no default administrator account or password. On first boot the server
generates a random setup token inside its protected data volume. Setup does
**not** print the token automatically; when the app is ready, retrieve it
explicitly on the host:

```sh
docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

If Docker requires privilege, use `sudo docker compose exec` instead. This
command prints the secret to your terminal; protect terminal history/capture.
Use the wizard to create the owner with a strong unique password. The setup
transaction can succeed only once; the token cannot create another owner
afterward. A setup token is not an administrator password.

On a rerun, preserve the existing private `.env`, PostgreSQL and application
volumes, and encryption key. Review and confirm any proposed reconfiguration;
back up before changing network mode or upgrading. Never run
`docker compose down -v` against an installation with data. See
[operations, backup and restore](operations.md).

For public domain + HTTPS, Caddy accepting its configuration (including a
reported "active" status) is **not** proof that ACME issued a certificate or
that the site works externally. From a separate network, open the exact HTTPS
installation URL, inspect the trusted certificate and test public links through
the proxy before sending mail. DNS pointing to the server alone is not enough.

## Manual Docker setup (advanced)

### Install Docker Engine on a fresh Ubuntu server

For a **fresh Ubuntu 24.04 or 26.04 server without Docker**, install Docker
Engine and Compose v2 using Ubuntu's default apt repositories. No additional
repository, key, or manual dependency installation is needed; apt installs
the packages required by `docker.io` and `docker-compose-v2`.
Compose is required to run this project's `compose.yaml`, not as a separate
Campaigns application.

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo docker --version
sudo docker compose version
```

If Docker Engine and Compose v2 already work on your server, skip the install
commands. Do not replace or remove an existing Docker installation, repository,
Snap package, configuration, or volumes as part of this quickstart; back up
and plan any migration separately. In particular, do not disable AppArmor or
Docker security controls to work around Snap Docker permission errors.
Keep using `sudo docker compose` if your account cannot access the Docker
socket. Do not add untrusted users to the `docker` group: membership grants
root-equivalent host access. The manual steps below assume Docker
and Compose v2 are already working.

### Start Docker Compose manually

From the extracted release archive or repository directory:

```sh
./install.sh
docker compose up -d --build
```

`install.sh` is the low-level manual initializer, not the guided installer.
It writes a mode-0600 `.env`, generates a random PostgreSQL secret
without printing it, and creates local
operator-owned backup directories. It never downloads or executes remote
code. Compose automatically wires PostgreSQL, waits for its health check, uses
persistent named volumes, and binds Campaigns to `127.0.0.1:8080` by default.
On first start, Campaigns generates its separate file-encryption key inside
the protected application volume. There is no shared default administrator
password.

Open `http://localhost:8080/campaigns/install` on the host. Retrieve the
one-time token explicitly with the command in the guided quickstart above,
then use the wizard to create the owner and set the public URL.

### Connect your domain over HTTPS manually

The included optional Caddy service can terminate HTTPS for a Linux server
with a public address. Choose a hostname you control, for example
`campaigns.example.com` (replace it with your actual domain). Add a DNS
`A` record pointing to the server's public IPv4 address. Add `AAAA` only if
IPv6 reaches the same server. Open inbound TCP 80 and 443 (and optionally
UDP 443) in the host and cloud firewalls. Make sure no other web server owns
80/443. If the machine is behind NAT, forward 80/443 to it; a carrier-grade
NAT address without inbound connectivity will not work. Wait for DNS to
resolve to your server **before** starting Caddy; ACME certificate issuance
depends on public reachability, and DNS alone never proves HTTPS works.

After running `./install.sh`, edit its private `.env` to add:

```dotenv
CAMPAIGNS_DOMAIN=campaigns.example.com
CAMPAIGNS_TRUST_PROXY=true
```

`CAMPAIGNS_DOMAIN` is a hostname, not a URL; no protocol, path, wildcard or
port. Start both the app and the included HTTPS proxy:

```sh
docker compose --profile https up -d --build
```

Alternatively, after installing Campaigns through trusted localhost access,
open **Workspace Settings → Program domain and HTTPS** as an administrator
with installation-settings permission. Enter the domain and select **Automatic
Caddy certificate** (the default). The hostname is staged in private storage;
you must still start the HTTPS Compose profile above. Caddy loads approved
changes without restarting the Campaigns application, retains the last working configuration if a
replacement cannot be loaded, and manages publicly trusted certificates for
the one installation hostname. The status "active" means Caddy accepted the
configuration, **not** that DNS, ACME issuance or public reachability succeeded:
test the external browser address and certificate independently. Configuration
is unavailable in hosted previews and other setups without the managed Caddy
profile. No customer DNS is modified.

For your own certificate, choose **Upload my certificate** and submit an
unencrypted PEM private key and matching PEM fullchain from the administrator
page over HTTPS or localhost. The private key never appears in a response or
audit record. Protect your administrator session and backups: the private
key resides in the restricted `campaigns-https-site` Docker volume. Uploaded
certificates are **not** renewed by Caddy; replace before expiry. Changing
certificates does not replace your app's separately configured Public URL.
Changing between automatic and uploaded certificates briefly restarts only
Caddy's proxy process (the Campaigns app and database keep running). Check
HTTPS reachability after every change; if the new proxy configuration cannot
start, the proxy retries its last working configuration.

For a Cloudflare-proxied hostname, use **Full (strict)** in Cloudflare SSL/TLS,
not Flexible. Automatic Caddy certificates can provide a publicly trusted
origin when ACME HTTP/TLS challenges reach the origin; Cloudflare edge TLS is
managed separately. Or select **Upload Cloudflare Origin CA certificate** and
upload its matching key. Origin CA is trusted by Cloudflare in Full (strict)
but **not by browsers connecting directly to the origin**. Keep the DNS record
proxied in that case. No Cloudflare API token is needed; this does not
configure Cloudflare or bypass DNS/firewall requirements. Wildcard certificates
are not issued automatically: these modes configure the single entered host.

The **Tracking domains** page at `/campaigns/domains` proves DNS ownership of
separate campaign-link and web-version hostnames. It does **not** issue HTTPS
certificates for them. Route each such hostname and base path to Campaigns
through a reverse proxy with its own trusted TLS certificate; the managed
installation Caddy hostname setting does not configure additional hosts.

Use the **same** `--profile https` option on later Compose upgrades. Caddy
persists ACME certificate state in `campaigns-caddy-data`; retain that volume
across upgrades and allow outbound ACME traffic. It forwards **all** requests
to the private `campaigns:8080` container, including `/campaigns/`,
`/api/campaigns/`, and root `/public/campaigns/` tracking links. Compose
still binds the app's port 8080 to host loopback; PostgreSQL is internal and
must not be exposed. `CAMPAIGNS_TRUST_PROXY=true` trusts only the immediate
proxy hop; do not set it when the application is reachable directly from
untrusted clients or when your upstream sends untrusted forwarding headers.

Visit `https://campaigns.example.com/campaigns/install` **before** creating
the owner. Enter exactly `https://campaigns.example.com/campaigns/` as the
public URL; the application uses it for subscribe/unsubscribe, browser
pages, and future tracking links. A setting change cannot rewrite already
delivered email links, so retain the old hostname/proxy routes for their
lifetimes. Test an unprivileged/public subscription page over HTTPS and an
actual link generated by a **local test fixture** before a real send. A valid
certificate, correct host, and accessible `/public/campaigns/` routes are
separate checks; opening the dashboard alone does not verify tracking.
Never use an IP, `http://localhost`, or a preview hostname for production
outbound links.

If you use a different trusted reverse proxy instead of Caddy, forward all
paths on the same hostname, preserve `Host` and the genuine HTTPS scheme,
terminate TLS with a publicly trusted certificate, and keep application
port 8080 reachable only from the proxy. Do not strip the `/campaigns/`
prefix on its way to the standalone server.

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

## Sending from an SMTP server you operate

Campaigns is an outbound SMTP **client**, not an SMTP server. It does not
install Postfix, sign DKIM, assign a public IP, manage PTR, or collect SMTP
bounces. You must operate and secure an MTA separately and ensure your hosting
provider permits outbound TCP 25 to recipient MX servers. The web hostname
and sending hostname may differ: `campaigns.example.com` serves HTTPS;
`mail.example.com` identifies the MTA and its public static IP.

On your mail host, configure its public forward `A`/`AAAA` records, an
operator-managed PTR/rDNS matching the MTA's forward DNS and HELO/EHLO name,
one valid SPF record authorizing that sending IP, DKIM signing for the From
domain, and aligned DMARC (start at `p=none` while monitoring reports).
Configure a bounce/return-path domain and receive/process bounces and
complaints; generic SMTP acceptance is **not** inbox delivery and generic
SMTP has no automatic provider analytics callback. Never operate an open
relay. Restrict authenticated submission to your Campaigns host and protect
credentials; verify your MTA's TLS certificate and outbound firewall.
Incoming port 25/MX is necessary only for the addresses receiving replies
or bounces, not for the Campaigns dashboard.

In **Providers**, add a **Generic SMTP relay** using the MTA's DNS hostname,
port **587 with required STARTTLS** (or 465 with implicit TLS), and your
MTA-issued submission credentials. TLS is required for production SMTP
delivery. For a separate public-IP MTA, its public DNS address works with
Campaigns' default private-address protection. For a Docker-local or
RFC1918-only MTA, `localhost` inside the Campaigns container means the
Campaigns container, **not** the host. Private targets are blocked by default
to prevent server-side request forgery. For an operator-managed private MTA,
the trusted operator with both provider-management and installation-settings
permissions can select **Allow a private SMTP host** on that Generic SMTP
provider only after isolating its network. Use a hostname whose SMTP
TLS certificate validates (an IP or `localhost` often will not), that
resolves inside the Campaigns container. Never enable this exception for
arbitrary destinations or untrusted provider editors. Even with this option,
link-local metadata endpoints and reserved addresses remain blocked; only
ordinary private network ranges and loopback are eligible. A provider
verification tests TLS/reachability/authentication **without sending mail**;
it cannot verify public IP reputation, DNS alignment, recipient delivery or
bounce processing. Do not send production campaigns until those checks are
independently complete.

### Troubleshooting your domain and mail host

- If HTTPS will not start, check that `CAMPAIGNS_DOMAIN` contains only a real
  DNS hostname and that the `A` record (and any `AAAA` record) reaches this
  server. Check the host/cloud firewall and NAT for inbound TCP 80/443; Caddy
  cannot obtain a certificate if the public ACME checks cannot reach it.
  Keep the Caddy data volume (`campaigns-caddy-data`) with your backup plan
  so certificate state survives replacement or restore. Do not copy private
  keys or the volume into a public archive.
- If the dashboard works but public links fail, open the exact HTTPS
  `/campaigns/subscribe` and `/campaigns/unsubscribe` pages and a locally
  generated `/public/campaigns/` web/open/click fixture. Forward all paths
  through your proxy unchanged. Old emailed links using
  `/campaigns/public/campaigns/` must also remain routable.
- If SMTP verification fails, confirm that its hostname resolves *inside*
  the Campaigns container and its certificate matches that hostname. An
  SMTP server on the host is **not** at `localhost` inside a container.
  Confirm submission port 587/465, TLS mode, credentials and network policy;
  only trusted operators should enable private-host routing. Check that
  your mail provider permits the MTA's separate outbound TCP 25 connection
  to recipient MX servers. Your sending hostname's forward DNS and PTR
  should agree with HELO, and SPF/DKIM/DMARC must authorize the actual sender
  domain/IP. Successful verification does not prove any recipient received
  mail or that bounces are being handled.
