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

Create the key in SendRepute's API access page with **Use with Campaigns
(select required permissions)** for all Campaigns features. This selects
`account:read`, `catalog:read`, `usage:read`, `builder:read`,
`builder:write`, `vip:read`, `vip:builder`, `ai:generate`, `models:read`,
`classify`, `rewrite`, and `vip:purchase`. Activation only checks the first
three; models, classification, rewrite quote/apply, insights, hosted editors,
paid designs and VIP purchase need the other permissions when used. This preset
does not include invoice/deposit `billing:read` or `billing:write`; those are
not Campaigns operations. Paid actions still require explicit consent, wallet
funds and appropriate Campaigns role permissions.

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
`git pull --ff-only && ./setup.sh --mode resume` as described in the [repository README](https://github.com/sendrepute/sendrepute-campaigns#update);
never force-reset private settings or delete volumes.

Alternatively, use a versioned release archive:

Download the [v0.1.31 ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.31/downloads/sendrepute-campaigns-0.1.31.zip)
or [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.31/downloads/sendrepute-campaigns-0.1.31.tar.gz)
and verify it against the [published SHA-256 checksums](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.31/downloads/sendrepute-campaigns-0.1.31-SHA256SUMS).
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

For **Public DNS hostname**, enter a subdomain you control, for example
`campaigns.example.com` (replace it with your own). Enter only the hostname:
**no scheme (`https://`), port or path**. Point that exact hostname's public
DNS `A` record to this server; use `AAAA` only with working IPv6. The example
is illustrative, not a hostname to use for your installation.

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
The **Workspace name** in Settings appears on public subscribe and unsubscribe
pages instead of the product name. Set it to a name recipients recognize; it
does not change the Public URL.

**CAMPAIGNS READY FOR OWNER SETUP** confirms local container health only:
owner setup is still required, and public access and HTTPS have not been
verified. For HTTPS, first open the printed installation page from another
network and verify a valid, trusted certificate with no browser warnings.
If the certificate is pending or invalid, stop; do **not** enter the setup
token, owner password or API key until HTTPS is valid.

There is no default administrator account or password. On first boot the server
generates a random setup token inside its protected data volume. For a new,
uninstalled owner, this one-time token is **required**, not optional. Setup does
**not** print it automatically. Once your chosen access is ready, retrieve it
explicitly **on the server, from the same cloned or extracted project directory**:

```sh
sudo docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Omit `sudo` if your Docker account does not require it. This
command prints the secret to your terminal; protect terminal history/capture.
Copy the command output and paste it into the **Setup token** field on the
installation page (also labelled **Installer setup token**). Fill in the owner
details with a strong unique local administrator password and the corresponding
Public URL, then complete SendRepute activation and owner setup in the wizard.
Never put the token in a URL or share it in a support message. The setup
transaction can succeed only once; the token cannot create another owner
afterward. An already installed workspace does not need another setup token.
A setup token is not an administrator password.

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

## Guided setup command cookbook

Run `./setup.sh` **on your Ubuntu VPS, from inside the cloned or extracted
`sendrepute-campaigns` directory**, not in a terminal on your local computer.
The [fresh Ubuntu clone sequence](#guided-docker-quickstart) is only for a new
installation. An existing installation must preserve its `.env`, PostgreSQL
and application volumes, encryption key, and backups; never clone over it,
force-reset a changed repository, or run `docker compose down -v`. Setup reads
existing settings and asks before changing exposure. It does not configure
DNS, set your installed workspace's saved Public URL, or prove external TLS.

### New installation with a public HTTPS hostname

Point the exact DNS hostname you own to the VPS public IPv4 with an `A` record;
publish `AAAA` only if inbound IPv6 works. Allow TCP 80/443 through cloud and
host firewalls (and NAT forwarding if applicable), and make sure neither port
is occupied by another service. On the VPS, after cloning/extracting:

```sh
./setup.sh --mode https --host campaigns.sendrepute.com
```

Replace `campaigns.sendrepute.com` with **your actual hostname**.
`campaign.sendrepute.com` and `campaigns.sendrepute.com` are different DNS
records. `--host` takes only a DNS name, not `https://`, a port, or a path.
This mode starts the included Caddy `https` Compose profile in front of the
backend, which stays bound to host loopback. DNS only resolves a name; it does
**not** forward 443 to the app's port 8080. If using Cloudflare's proxy, set
its origin SSL/TLS mode to **Full (strict)**, never Flexible. ACME still needs
reachable ports and working DNS; confirm the actual trusted certificate and
HTTPS URL **from another network**. Do not enter secrets while the certificate
is pending or invalid. For the new owner, after the trusted certificate is
verified, open `https://YOUR_HOSTNAME/campaigns/install`, paste the required
one-time token into **Setup token**, complete the owner details/activation and enter
`https://YOUR_HOSTNAME/campaigns/` as the wizard Public URL, with the trailing
slash.

### Migrate an installed public-IP HTTP workspace to HTTPS

Back up your database, application data/encryption key and private `.env`
first. Arrange the DNS, HTTPS ports, firewall, NAT and Cloudflare Full
(strict) prerequisites above. From the **existing project directory on the
VPS**, run:

```sh
./setup.sh --mode https --host campaigns.sendrepute.com
```

Replace the example hostname with the one whose DNS you actually configured.
When changing existing exposure, interactive setup reviews the change and
asks you to type `yes`; `--confirm-change` is only for deliberate unattended
authorization. It preserves existing secrets and volumes, starts Caddy and
binds the backend to loopback; expect a brief interruption while services
reconfigure. **An already installed workspace must separately change its
saved Public URL** in **Workspace Settings → Public URL** to
`https://YOUR_HOSTNAME/campaigns/` after external HTTPS works. Running setup
does not rewrite the database setting or links already sent in email; keep
old link routes reachable as necessary and test signup/unsubscribe/public
links before sending. An installed workspace does not need a second owner
setup token.

### Public-IP HTTP (unencrypted) or local-only access

Direct IPv4 HTTP requires a routable public IPv4 address, firewall/NAT access
to the selected backend port (default 8080) and **explicit consent**:

```sh
./setup.sh --mode http --host YOUR_PUBLIC_IP
```

Replace `YOUR_PUBLIC_IP` with your actual public IPv4 (no scheme or port).
Interactive setup asks you to acknowledge unencrypted HTTP and, if applicable,
confirm the change in existing exposure. Passwords, setup tokens and sessions
can be intercepted: **do not use this as secure production access**. On a new
install, open `http://YOUR_PUBLIC_IP:8080/campaigns/install` and enter
`http://YOUR_PUBLIC_IP:8080/campaigns/` in the wizard, replacing the IP. Use
HTTPS whenever possible.

For server-only access, run the following **on the VPS**:

```sh
./setup.sh --mode local
```

Then, **on your own computer** (not the VPS), open a trusted SSH tunnel:

```sh
ssh -o ExitOnForwardFailure=yes -N -L 18080:127.0.0.1:8080 USER@YOUR_SERVER_HOST
```

Replace `USER` and `YOUR_SERVER_HOST`. On that computer, visit
`http://127.0.0.1:18080/campaigns/install` for a new installation (or
`http://127.0.0.1:18080/campaigns/` if already installed). The wizard Public
URL when using this tunnel is `http://127.0.0.1:18080/campaigns/`; `localhost`
on your computer is not the VPS.

### Resume, upgrade and diagnostics

To keep an already initialized installation's access mode and settings, run
this **in its project directory on the VPS**:

```sh
./setup.sh --mode resume
```

For an existing Git clone upgrade, first back up PostgreSQL, application
data/encryption key and `.env` using the
[full Docker backup procedure](operations.md#docker-infrastructure-backup),
then in that **existing clone**:

```sh
git status --short
git pull --ff-only && ./setup.sh --mode resume
```

If pull refuses due to local edits, especially to `compose.yaml`, preserve
and reconcile them; do not overwrite `.env` or reset/delete volumes. Keep the
same Compose project and database; do not run old and new copies concurrently.
On an archive upgrade, extract into a **new directory**, verify the checksum,
carry over the same private `.env` and project/volume configuration, stop the
old service before starting the new one, then resume setup there. If changing
to HTTPS as part of an upgrade, choose the HTTPS migration command above
instead of `--mode resume`.

From the project directory, these commands inspect services **without
printing the one-time setup token**:

```sh
docker compose --profile https ps
docker compose --profile https logs --tail=100 campaigns https postgres
```

If Docker requires privilege, use `sudo docker compose` instead. Logs can
still contain hostnames, addresses or sensitive values: redact before sharing.
On your **own computer**, check the actual HTTPS address and trusted
certificate with a browser; local health and `ps` do not prove ACME success.
Retrieve the one-time token **only for a new, uninstalled owner**, explicitly
on the VPS with the `docker compose exec campaigns cat ...` command above;
never paste the token, `.env` or unredacted logs into a support message.

### All supported setup flags

| Flag | Meaning |
| --- | --- |
| `--mode local\|http\|https\|resume` | Local server/SSH tunnel, public-IP HTTP, HTTPS DNS hostname, or preserve an **existing** `.env` configuration. Interactive `./setup.sh` asks which mode to use. |
| `--host HOST` | DNS hostname with `--mode https`, routable IPv4 with `--mode http`; no URL scheme, port or path. For `--mode resume`, only a previously configured public-HTTP mode may take a host. |
| `--accept-http` | Explicitly acknowledges the unencrypted HTTP warning for unattended `--mode http` changes. Interactive setup instead asks for confirmation. |
| `--confirm-change` | Explicitly authorizes changing an existing installation's exposure unattended. Interactive setup instead asks; this does not bypass HTTPS DNS/certificate checks. |
| `--install-docker` | Explicit authorization to install Ubuntu `docker.io` and `docker-compose-v2` **only if Docker is missing** on Ubuntu 24.04/26.04; interactive setup asks first. Never removes Snap Docker, old packages or volumes. |
| `--wait-seconds 1..600` | Container readiness wait in seconds; default 120. Not a TLS/ACME external verification timeout. |
| `--help`, `-h` | Print setup usage without starting installation. |

Unattended examples must include all applicable explicit consent flags: a
fresh Ubuntu host missing Docker can use
`./setup.sh --mode https --host YOUR_HOSTNAME --install-docker`; a deliberate
existing HTTP-to-HTTPS change can use
`./setup.sh --mode https --host YOUR_HOSTNAME --confirm-change`; and an
existing-exposure change to unencrypted HTTP requires
`./setup.sh --mode http --host YOUR_PUBLIC_IP --accept-http --confirm-change`.
Do not include these authorization flags without the corresponding informed
decision. `--help` shows the authoritative parser usage.

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

**Already using HTTPS through Cloudflare or another reverse proxy?** This
Caddy setup is optional. If your existing setup already serves Campaigns over
HTTPS, skip this section and leave that setup in place. Keep the installation
Public URL set to `https://your-domain/campaigns/`. Caddy's `not-configured`
status describes only the included Caddy proxy, not the security of your public
URL. Cloudflare's browser-facing certificate alone does not prove the origin
connection is encrypted: use **Full (strict)** with a valid origin certificate
for a proxied origin, or a securely configured Cloudflare Tunnel.

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

For Cloudflare-proxied hostnames, use **Full (strict)**, never Flexible.
Automatic Caddy certificates provide public certificate management when ACME
challenges reach the origin; Cloudflare edge TLS is separate. Alternatively,
select **Upload Cloudflare Origin CA certificate** and supply its matching key.
Origin CA requires Cloudflare proxying and is **not directly browser-trusted**.
Neither choosing this mode nor matching the hostname proves actual Cloudflare
trust; verify externally. No Cloudflare API token is needed, and DNS/firewall
requirements still apply. Caddy does not automatically issue wildcard
certificates; an existing uploaded wildcard or SAN certificate may be reused
for covered, verified tracking names.

With the included managed HTTPS/Caddy installation already running, the
**Tracking domains** page at `/campaigns/domains` verifies ownership and
automatically queues additional hostnames on this same instance. Users add
public A/AAAA and the displayed TXT, then click **Check DNS and verify**; no
per-domain shell command or proxy edit is needed. Multiple hosts coexist
without changing the primary hostname/certificate or existing campaign choices.
Select the desired verified host independently in each campaign. External
reverse proxies/Tunnels remain operator-managed and require manual hostname
routing and HTTPS.

For each verified tracking hostname, Caddy explicitly reuses the primary
uploaded/Origin CA certificate when its SAN covers that hostname; uncovered
names use automatic individual certificates. Reuse does not establish browser
or actual Cloudflare trust. Covered Origin CA names require Cloudflare proxying
with **Full (strict)** and are not directly browser-trusted. Uploaded certificates
need replacement before expiry. DNS and ports 80/443 must reach the server;
allow ACME challenges when automatic certificates are needed.

For a separate subdomain such as `links.example.com`, leave **Base path** at
`/`. Managed Caddy automatically maps custom base paths such as `/tracking/`
to this instance’s public tracking routes. With an external proxy/Tunnel, its
operator must configure that mapping.

Before clicking **Check DNS and verify**, complete both DNS requirements:

1. Create the challenge in Campaigns.
2. Connect the bare hostname `links.example.com` to this installation using an
   A/AAAA record for the server's public address, an appropriate CNAME, or a
   Cloudflare Tunnel public-hostname configuration. Do not add `_sendrepute`
   to this routing record.
3. Separately publish the exact TXT name and value displayed by Campaigns.
   `_sendrepute.links.example.com` is the ownership record, not the hostname
   used to open links. Keep both the routing record and the TXT record.
4. Once DNS is visible publicly, click **Check DNS and verify**. The check
   requires both public address resolution for the bare hostname and the
   matching TXT value. Adding only TXT cannot pass this check.
5. Verification queues the hostname for managed Caddy to load; it does not mean
   HTTPS is already working. Test a valid public link before real sends. Choose
   the verified hostname independently in each campaign’s **Tracking domain**
   field; verification does not select it automatically or replace the
   installation domain. External proxy/Tunnel operators must configure and test
   routing, base paths and HTTPS themselves.

DNS ownership, Caddy configuration acknowledgement and working public HTTPS
are separate facts. A loaded configuration is not proof of certificate
issuance or trust, and SAN coverage alone does not prove browser or Cloudflare
trust. Campaigns does not create DNS records. If managed Caddy is not running
or primary HTTPS is not configured, additions remain queued. Deleting a
selectable domain or rotating its challenge does not remove historical approved
routes; keep their DNS and certificate renewal available.

Use the **same** `--profile https` option on later Compose upgrades. Caddy
persists ACME certificate state in `campaigns-caddy-data`; retain that volume
across upgrades and allow outbound ACME traffic. The primary Caddy site forwards
management `/campaigns/`, `/api/campaigns/` and root `/public/campaigns/` routes
to the private `campaigns:8080` container. Additional tracking sites expose only
public tracking routes, automatically mapping custom base paths; other paths
return 404. Compose
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

The included Docker runtime installs Linux `flock` (`util-linux`) for
race-safe managed HTTPS updates. A bare Node.js installation that opts into
the shared managed-Caddy site directory must also install `util-linux` and
confirm `command -v flock` succeeds under the Campaigns service account.
The shared filesystem must support advisory file locking. Do not delete or
replace `.write-lock`: the kernel releases its lock when the owner exits.
If locking is unavailable, managed updates report an error rather than
claiming a hostname is configured. External-proxy installations that do not
enable the managed site directory do not use this helper.

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

### Campaign templates and draft copy

Selecting a template fills a blank campaign **Subject** and **Preview text**
independently from the template's authored values; whitespace-only draft fields
count as blank. Existing custom text in either field is preserved. If the
template has no authored preview/preheader, the campaign preview stays blank:
the subject is not copied into it.

### Campaign sender defaults and review

In a new draft, **From name** and **From email** fill from installation Settings
only while the individual fields are untouched and empty. Existing custom
campaign senders are not overwritten. To intentionally replace both fields,
choose **Use sender from Settings** in the campaign editor. Review the shown
sender before **Send**, **Schedule** or **Test**; **Change sender** returns to
the editor without submitting that action. If the name or email is missing or
invalid, correct it before proceeding; the server rejects invalid sender
details as well. Review the saved draft after changing installation defaults:
defaults do not silently rewrite a previously chosen sender. This UI is
available in English and 13 non-English locales with AI-assisted (Gemini)
translations.

Brands expose only **name**, **From name**, **From email** and **Reply-to** in
their editor. Selecting a brand explicitly fills the campaign's three sender
fields from that brand; an existing draft's custom sender remains its own until
you choose a brand or deliberately reset it. Review the sender before sending.
Older stored logo/color columns are retained for backup compatibility but
are not editable brand controls.

### Campaign sending threads and unsubscribe reporting

In the campaign editor, **Threads (simultaneous sends)** controls concurrent
requests for that campaign: select **1–10**, with **1** as the default. Change
this only while the campaign is a draft; queued/sent campaign snapshots cannot
be edited. The worker also caps total concurrent jobs at 10, and the existing
per-provider rate limiter still applies across campaigns. More threads do not
override your provider's limits or guarantee faster delivery or inbox placement.
Increase cautiously and monitor provider responses, queue outcomes and
suppression behavior. The new campaign control is available in the UI's 13
non-English locales; AI-assisted (Gemini) translations should be reviewed if
you rely on localized text for operational decisions.

Campaign unsubscribe links minted during dispatch now retain the accepted
delivery job's identity. A successful first-party opt-out records one
`first_party_unsubscribed` event for that job; campaign and overview reports
count distinct jobs across provider and first-party unsubscribe signals, so
the same job is not counted twice. **Previously issued, unlinked unsubscribe
links still opt recipients out but cannot be attributed retroactively** to a
campaign. Administrative/list-level opt-outs are not manufactured as campaign
events; provider-only analytics is unchanged. Upgrade migrations run on
startup: migration **032** adds token/job attribution and a unique event
index, while the updated **016** housekeeping event constraint retains
`first_party_unsubscribed` coverage. Do not rewrite old tokens or manually
backfill attribution; back up your database before upgrading.

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
