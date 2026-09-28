import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync, chmodSync, readdirSync, rmSync, lstatSync } from "node:fs";
import { join } from "node:path";
const root = process.env.CAMPAIGNS_HTTPS_SITE_DIR;
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
export function configureSite(input) {
    if (!root)
        throw Object.assign(new Error("Managed Caddy is unavailable on this installation"), { status: 503 });
    const site = validateSite(input);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const revision = `site-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
    const dir = join(root, revision);
    mkdirSync(dir, { mode: 0o700 });
    const config = `${site.domain} {\n  encode zstd gzip\n  reverse_proxy campaigns:8080\n${site.mode === "automatic" ? "" : `  tls /run/campaigns-site/${revision}/fullchain.pem /run/campaigns-site/${revision}/private-key.pem\n`}}\n`;
    writeFileSync(join(dir, "Caddyfile"), config, { mode: 0o600, flag: "wx" });
    if (site.mode !== "automatic") {
        writeFileSync(join(dir, "fullchain.pem"), site.certificate, { mode: 0o600, flag: "wx" });
        writeFileSync(join(dir, "private-key.pem"), site.privateKey, { mode: 0o600, flag: "wx" });
    }
    writeFileSync(join(dir, "site.json"), JSON.stringify({ domain: site.domain, mode: site.mode, revision, expiresAt: site.expiresAt }), { mode: 0o600, flag: "wx" });
    const tmp = join(root, `.next-${revision}`);
    symlinkSync(revision, tmp, "dir");
    renameSync(tmp, join(root, "active"));
    // Bound storage without deleting the currently running Caddy configuration.
    let lastGood = "";
    try {
        lastGood = readlinkSync(join(root, "last-good"));
    }
    catch { /* no successful activation yet */ }
    const previous = readdirSync(root).filter(name => /^site-\d+-\d+-[a-f0-9]+$/.test(name)).sort().reverse();
    for (const old of previous.slice(5)) {
        if (old !== revision && old !== lastGood && lstatSync(join(root, old)).isDirectory())
            rmSync(join(root, old), { recursive: true });
    }
    return siteStatus();
}
//# sourceMappingURL=https-site.js.map