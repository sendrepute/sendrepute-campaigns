import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync, chmodSync, readdirSync, rmSync, lstatSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const root = process.env.CAMPAIGNS_HTTPS_SITE_DIR;
const revisionPattern = /^site-\d+-\d+-[a-f0-9]+$/;
let trackingSyncFailed = false;
const hostname = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
export function validSiteDomain(value) {
    if (typeof value !== "string" || value.length > 253 || value !== value.trim())
        invalid("Enter one public DNS hostname, without a scheme or path");
    const domain = value.toLowerCase();
    if (!hostname.test(domain) || /\.(?:localhost|local|test|example|invalid|internal)$/i.test(domain))
        invalid("Enter one public DNS hostname, without a scheme or path");
    return domain;
}
export function validateSite(input) {
    const domain = validSiteDomain(input.domain);
    if (!["automatic", "uploaded", "cloudflare-origin"].includes(String(input.mode)))
        invalid("Invalid HTTPS certificate mode");
    const mode = input.mode;
    if (mode === "automatic") {
        if (input.certificate !== undefined || input.privateKey !== undefined)
            invalid("Automatic HTTPS does not accept uploaded keys");
        return { domain, mode };
    }
    if (typeof input.certificate !== "string" || typeof input.privateKey !== "string" ||
        Buffer.byteLength(input.certificate) > 65536 || Buffer.byteLength(input.privateKey) > 32768 ||
        /[\uFFFD\u0000]/.test(input.certificate) || /[\uFFFD\u0000]/.test(input.privateKey) ||
        !input.certificate.includes("-----BEGIN CERTIFICATE-----") ||
        !/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(input.privateKey))
        invalid("Upload a PEM fullchain and matching unencrypted private key (maximum 64 KB and 32 KB)");
    try {
        const first = input.certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
        if (!first?.length || first.join("").replace(/\s/g, "") !== input.certificate.replace(/\s/g, ""))
            invalid("Invalid PEM certificate chain");
        if (first.length > 8 || (mode === "uploaded" && first.length < 2))
            invalid("Upload an ordered PEM fullchain including the leaf and its issuing CA certificate");
        const chain = first.map(pem => new X509Certificate(pem));
        const leaf = chain[0];
        const now = Date.now();
        for (const cert of chain) {
            if (new Date(cert.validTo).getTime() <= now + 24 * 60 * 60 * 1000 ||
                new Date(cert.validFrom).getTime() > now + 5 * 60 * 1000)
                invalid("Certificate chain contains an expired or not-yet-valid certificate");
        }
        if (leaf.checkIssued(leaf) && leaf.verify(leaf.publicKey))
            invalid("A self-signed leaf certificate is not a trusted browser or Cloudflare Origin CA certificate");
        for (let i = 0; i < chain.length - 1; i++) {
            if (!chain[i].checkIssued(chain[i + 1]) || !chain[i].verify(chain[i + 1].publicKey))
                invalid("Certificate chain is out of order or has an invalid issuer signature");
        }
        if (!leaf.checkHost(domain, { subject: "never" }) || !leaf.checkPrivateKey(createPrivateKey(input.privateKey)))
            invalid("Certificate hostname or private key does not match");
        const expires = new Date(leaf.validTo);
        return { domain, mode, certificate: input.certificate, privateKey: input.privateKey, expiresAt: expires.toISOString() };
    }
    catch (error) {
        if (error instanceof Error && "status" in error)
            throw error;
        return invalid("Invalid certificate or private key PEM");
    }
}
export function siteStatus() {
    if (!root)
        return { available: false, state: "operator-required", message: "Managed Caddy is not available here. Activate the self-host HTTPS profile on your server." };
    let site;
    try {
        site = JSON.parse(readFileSync(join(root, "active", "site.json"), "utf8"));
    }
    catch { /* no submitted site */ }
    let result;
    try {
        result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    }
    catch { /* Caddy has not acknowledged it */ }
    const running = result && Number.isSafeInteger(result.lastSeen) && Date.now() / 1000 - result.lastSeen < 20;
    return { available: true, state: site ? !running && result ? "operator-required" : result?.revision === site.revision ? result.state : "pending" : "not-configured",
        domain: site?.domain, mode: site?.mode, expiresAt: site?.expiresAt,
        message: site?.mode === "cloudflare-origin" ? "Origin CA mode cannot prove Cloudflare trusts the uploaded certificate. Keep Cloudflare proxied, select Full (strict), and verify the connection externally; Origin CA is not browser-trusted directly." :
            site?.mode === "uploaded" ? "Uploaded certificates do not renew automatically. Replace this certificate before expiry." :
                "Caddy handles public certificate issuance and renewal. DNS and inbound ports 80/443 must reach this server." };
}
function readSite(link = "active") {
    if (!root)
        return undefined;
    try {
        const site = JSON.parse(readFileSync(join(root, link, "site.json"), "utf8"));
        validSiteDomain(site.domain);
        if (!revisionPattern.test(site.revision) || !["automatic", "uploaded", "cloudflare-origin"].includes(site.mode) ||
            (site.certificateRevision && !revisionPattern.test(site.certificateRevision)))
            throw new Error("Invalid managed site metadata");
        return site;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function readHosts() {
    if (!root)
        return [];
    try {
        return JSON.parse(readFileSync(join(root, "tracking-hosts.json"), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
}
function normalizeHosts(hosts) {
    const distinct = new Map();
    for (const host of hosts) {
        const hostname = validSiteDomain(host.hostname);
        // Paths originate from normalized custom-domain configuration. Quoting in
        // the Caddyfile below prevents interpolation or configuration injection.
        const path = host.basePath;
        if (typeof path !== "string" || !path.startsWith("/") || !path.endsWith("/") ||
            /[\s\\?#{}\u0000-\u001f]/.test(path) || path.split("/").some(segment => segment === "." || segment === "..")) {
            throw new Error("Invalid approved tracking base path");
        }
        distinct.set(`${hostname}\n${path}`, { hostname, basePath: path });
    }
    return [...distinct.values()].sort((a, b) => a.hostname.localeCompare(b.hostname) || a.basePath.localeCompare(b.basePath));
}
// Cross-process exclusion covers BOTH primary-site changes and additive
// tracking changes. flock belongs to this inherited open-file description,
// not to a deletable pathname, and is released by the kernel on process death.
// Never replace/remove the lock inode or steal a lock based on its age.
async function writeLocked(operation) {
    if (!root)
        throw Object.assign(new Error("Managed Caddy is unavailable on this installation"), { status: 503 });
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const fd = openSync(join(root, ".write-lock"), "a", 0o600);
    try {
        // The short-lived child inherits fd 3; the parent keeps the same open-file
        // description alive through the entire synchronous critical section.
        const acquired = spawnSync("flock", ["-x", "-w", "10", "3"], {
            stdio: ["ignore", "ignore", "ignore", fd], timeout: 11000,
        });
        if (acquired.error || acquired.status !== 0) {
            throw Object.assign(new Error("Managed HTTPS locking failed or is busy; retry"), { status: 503 });
        }
        return operation();
    }
    finally {
        closeSync(fd);
    }
}
function atomicJson(name, value) {
    const temporary = join(root, `.${name}-${process.pid}-${Math.random().toString(16).slice(2)}`);
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(root, name));
}
/** Explicit verified names only; never use wildcard or unbounded on-demand TLS. */
export function renderSiteCaddyfile(site, hosts, certificate) {
    validSiteDomain(site.domain);
    if (site.mode !== "automatic" && !revisionPattern.test(site.certificateRevision ?? site.revision))
        throw new Error("Invalid managed certificate revision");
    const approved = normalizeHosts(hosts);
    const grouped = new Map();
    for (const host of approved)
        grouped.set(host.hostname, [...(grouped.get(host.hostname) ?? []), host]);
    const routes = (entries) => entries.filter(host => host.basePath !== "/").map(host => `  handle ${JSON.stringify(`${host.basePath}public/campaigns/*`)} {\n    uri strip_prefix ${JSON.stringify(host.basePath.slice(0, -1))}\n    reverse_proxy campaigns:8080\n  }\n`).join("");
    const certificateRevision = site.certificateRevision ?? site.revision;
    const leaf = site.mode === "automatic" ? undefined : new X509Certificate(certificate ??
        readFileSync(join(root, certificateRevision, "fullchain.pem"), "utf8"));
    const manualTls = `  tls /run/campaigns-site/${certificateRevision}/fullchain.pem /run/campaigns-site/${certificateRevision}/private-key.pem\n`;
    // Explicit same-file reuse yields the SAME Caddy certificate-selection tag
    // on covered SNI policies, even if an older automatic certificate is cached.
    // Coverage is SAN-only; it does not establish browser/Cloudflare trust.
    let config = `${site.domain} {\n  encode zstd gzip\n${routes(grouped.get(site.domain) ?? [])}  handle {\n    reverse_proxy campaigns:8080\n  }\n${leaf ? manualTls : ""}}\n`;
    grouped.delete(site.domain); // A verified primary hostname reuses its one site.
    for (const [hostname, entries] of grouped) {
        const publicPages = entries.filter(host => host.basePath !== "/campaigns/").map(host => ["subscribe", "unsubscribe"].map(page => `  handle ${JSON.stringify(`${host.basePath}${page}`)} {\n    redir /campaigns/${page}?{query} 302\n  }\n`).join("")).join("");
        const publicApis = entries.filter(host => host.basePath !== "/" && host.basePath !== "/campaigns/").map(host => `  handle ${JSON.stringify(`${host.basePath}api/campaigns/public/*`)} {\n    uri strip_prefix ${JSON.stringify(host.basePath.slice(0, -1))}\n    reverse_proxy campaigns:8080\n  }\n`).join("");
        config += `\n${hostname} {\n  encode zstd gzip\n${routes(entries)}${publicPages}${publicApis}  @publicSubscription path /campaigns/subscribe /campaigns/unsubscribe /campaigns/assets/* /api/campaigns/public/*\n  handle @publicSubscription {\n    reverse_proxy campaigns:8080\n  }\n  handle /public/campaigns/* {\n    reverse_proxy campaigns:8080\n  }\n  handle {\n    respond 404\n  }\n${leaf?.checkHost(hostname, { subject: "never" }) ? manualTls : ""}}\n`;
    }
    return config;
}
function stageSite(site, hosts, pem) {
    const revision = `site-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
    const dir = join(root, revision);
    mkdirSync(dir, { mode: 0o700 });
    const metadata = { domain: site.domain, mode: site.mode, revision, expiresAt: site.expiresAt,
        ...(site.mode !== "automatic" ? { certificateRevision: pem ? revision : site.certificateRevision ?? site.revision } : {}),
        trackingHosts: normalizeHosts(hosts), publicSubscriptionRoutes: true };
    writeFileSync(join(dir, "Caddyfile"), renderSiteCaddyfile(metadata, hosts, pem?.certificate), { mode: 0o600, flag: "wx" });
    if (pem) {
        writeFileSync(join(dir, "fullchain.pem"), pem.certificate, { mode: 0o600, flag: "wx" });
        writeFileSync(join(dir, "private-key.pem"), pem.privateKey, { mode: 0o600, flag: "wx" });
    }
    writeFileSync(join(dir, "site.json"), JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
    const tmp = join(root, `.next-${revision}`);
    symlinkSync(revision, tmp, "dir");
    renameSync(tmp, join(root, "active"));
    // Retain certificate dependencies as well as every last-good version.
    let lastGood = "", loading = "";
    try {
        lastGood = readlinkSync(join(root, "last-good"));
    }
    catch { /* no successful activation yet */ }
    try {
        loading = readlinkSync(join(root, "loading"));
    }
    catch { /* controller is idle or not running */ }
    const previous = readdirSync(root).filter(name => revisionPattern.test(name)).sort().reverse();
    const retain = new Set([revision, lastGood, loading, ...previous.slice(0, 5)]);
    for (const kept of [...retain]) {
        if (!revisionPattern.test(kept))
            continue;
        const reference = JSON.parse(readFileSync(join(root, kept, "site.json"), "utf8"));
        if (reference.certificateRevision)
            retain.add(reference.certificateRevision);
    }
    for (const old of previous.slice(5)) {
        if (!retain.has(old) && lstatSync(join(root, old)).isDirectory())
            rmSync(join(root, old), { recursive: true });
    }
}
export async function configureSite(input) {
    const site = validateSite(input);
    await writeLocked(() => stageSite(site, readHosts(), site.mode !== "automatic" ? { certificate: site.certificate, privateKey: site.privateKey } : undefined));
    return siteStatus();
}
/** Reconciliation is retryable after DNS/DB success but filesystem failure. */
export async function reconcileTrackingHttps(db, retryRejected = false) {
    if (!root)
        return;
    // Reconcile existing verified rows too (including a rolling upgrade or a
    // restored database), not only approvals created by this server revision.
    // This is DML after migration admission, never router-construction DDL.
    await db.query(`INSERT INTO campaigns.tracking_https_hosts(hostname,base_path)
    SELECT hostname,base_path FROM campaigns.custom_domains WHERE verified_at IS NOT NULL
    ORDER BY hostname,base_path ON CONFLICT DO NOTHING`);
    const result = await db.query("SELECT hostname,base_path FROM campaigns.tracking_https_hosts ORDER BY hostname,base_path");
    await writeLocked(() => {
        // Union protects concurrent snapshots and old delivered links, including
        // routes whose selectable custom-domain row has since been deleted.
        const hosts = normalizeHosts([...readHosts(), ...result.rows.map(row => ({ hostname: row.hostname, basePath: row.base_path }))]);
        atomicJson("tracking-hosts.json", hosts);
        let site = readSite();
        if (!site && process.env.CAMPAIGNS_DOMAIN)
            site = { domain: validSiteDomain(process.env.CAMPAIGNS_DOMAIN), mode: "automatic", revision: "" };
        if (!site || !hosts.length)
            return; // Queue until primary HTTPS is configured.
        let rejected = false;
        try {
            const status = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
            rejected = status.revision === site.revision && status.state === "rejected";
        }
        catch { /* no controller result yet */ }
        if (!site.publicSubscriptionRoutes || JSON.stringify(hosts) !== JSON.stringify(site.trackingHosts ?? []) || (retryRejected && rejected))
            stageSite(site, hosts);
    });
}
/** Startup can continue serving its last-good site on storage errors. The
 * explicit error remains visible in domain status until a retry succeeds. */
export async function synchronizeTrackingHttps(db, retryRejected = false) {
    try {
        await reconcileTrackingHttps(db, retryRejected);
        trackingSyncFailed = false;
        return true;
    }
    catch {
        trackingSyncFailed = true;
        return false;
    }
}
export function trackingHttpsStatus(hostname, basePath, verified, failure = trackingSyncFailed) {
    let proxyState = !root ? "operator-required" : !verified ? "unverified" : "pending";
    let proxyError = null;
    let certificateSource = root ? "not-configured" : "operator-required";
    if (root && verified) {
        if (failure) {
            proxyState = "error";
            proxyError = "Managed HTTPS update failed. DNS ownership is verified; check server storage and retry verification.";
        }
        else {
            try {
                const site = readSite();
                if (site) {
                    const covered = site.mode !== "automatic" &&
                        new X509Certificate(readFileSync(join(root, site.certificateRevision ?? site.revision, "fullchain.pem"), "utf8"))
                            .checkHost(hostname, { subject: "never" });
                    certificateSource = covered ? site.mode === "cloudflare-origin" ? "primary-cloudflare-origin" : "primary-uploaded" : "automatic";
                }
                const includes = site && ((site.domain === hostname && basePath === "/") || site.trackingHosts?.some(host => host.hostname === hostname && host.basePath === basePath));
                const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
                const running = Number.isSafeInteger(result.lastSeen) && Date.now() / 1000 - result.lastSeen < 20;
                if (includes && running && result.revision === site.revision) {
                    if (result.state === "active")
                        proxyState = "loaded";
                    else if (result.state === "rejected") {
                        proxyState = "error";
                        proxyError = "Caddy rejected the update. The last working configuration is retained; check Caddy and retry verification.";
                    }
                }
            }
            catch (error) {
                if (error.code !== "ENOENT") {
                    proxyState = "error";
                    proxyError = "Managed HTTPS status unreadable. Check server storage and retry verification.";
                }
            }
        }
    }
    return { required: true, configuredByApplication: proxyState === "loaded", proxyState, certificateState: "not-checked", certificateSource, proxyError };
}
//# sourceMappingURL=https-site.js.map