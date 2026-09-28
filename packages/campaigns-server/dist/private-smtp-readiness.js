import { promises as dns } from "node:dns";
import { createPublicKey } from "node:crypto";
import { isIP } from "node:net";
import { normalizeCustomDomain } from "./domains-tracking.js";
export const readinessResolver = {
    resolveTxt: host => dns.resolveTxt(host),
    async resolveAddresses(host) {
        const results = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
        if (results.some(result => result.status === "rejected" &&
            !["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(String(result.reason.code))))
            throw new Error("DNS lookup failed");
        return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    },
    reverse: ip => dns.reverse(ip),
};
const check = (key, status, detail, repair) => ({ key, status, detail, repair });
const deadline = (promise) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DNS deadline")), 2500); })])
        .finally(() => clearTimeout(timer));
};
const publicIp = (ip) => {
    if (isIP(ip) === 4) {
        const [a, b, c] = ip.split(".").map(Number);
        return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127) &&
            !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
            !(a === 192 && (b === 168 || b === 0 || b === 2)) && !(a === 198 && (b === 18 || b === 19 || b === 51)) &&
            !(a === 203 && b === 0 && c === 113);
    }
    if (isIP(ip) !== 6)
        return false;
    const value = ip.toLowerCase();
    return !(/^(::|::1$|fe[89ab]|f[cd]|ff|2001:db8|2001:0:|2001:0$|2001:20:|2001:10:|::ffff:)/.test(value));
};
const validSelector = (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
function parseTags(record) {
    const parts = record.trim().replace(/;\s*$/, "").split(";").map(part => part.trim());
    if (parts.some(part => !/^[a-z][a-z0-9]*\s*=\s*[^;]*$/i.test(part)))
        return null;
    const tags = new Map();
    for (const part of parts) {
        const at = part.indexOf("=");
        const key = part.slice(0, at).trim().toLowerCase();
        if (tags.has(key))
            return null;
        tags.set(key, part.slice(at + 1).trim());
    }
    return tags;
}
function dmarcPolicy(record) {
    const tags = parseTags(record);
    if (!tags || !/^v=DMARC1(?:\s*;|$)/i.test(record) || tags.get("v")?.toUpperCase() !== "DMARC1" ||
        !["none", "quarantine", "reject"].includes(tags.get("p") ?? ""))
        return "malformed";
    for (const [tag, value] of tags) {
        if (tag === "v" || tag === "p")
            continue;
        if (tag === "sp" || tag === "np") {
            if (!["none", "quarantine", "reject"].includes(value))
                return "malformed";
        }
        else if (tag === "adkim" || tag === "aspf") {
            if (!["r", "s"].includes(value))
                return "malformed";
        }
        else if (tag === "pct") {
            if (!/^\d{1,3}$/.test(value) || Number(value) > 100)
                return "malformed";
        }
        else if (tag === "ri") {
            if (!/^[1-9]\d*$/.test(value))
                return "malformed";
        }
        else if (tag === "rua" || tag === "ruf") {
            if (!value.split(",").every(uri => /^mailto:[^@\s,]+@[^@\s,]+\.[a-z]{2,}(?:!\d+[kmgt]?)?$/i.test(uri.trim())))
                return "malformed";
        }
        else
            return "unknown"; // Do not claim to validate a policy with unrecognized semantics.
    }
    return "pass";
}
const spfHost = (value) => {
    if (!/^[a-z0-9_.-]+$/i.test(value))
        throw new Error("Invalid SPF domain");
    normalizeCustomDomain(value.replace(/_/g, "a"));
    return value.toLowerCase();
};
const txt = async (resolver, host, count) => {
    if (++count.used > 12)
        throw new Error("DNS lookup budget exceeded");
    try {
        const records = await deadline(resolver.resolveTxt(host));
        if (records.length > 25 || records.some(parts => parts.join("").length > 4096))
            throw new Error("DNS answer exceeds inspection budget");
        return records.map(parts => parts.join(""));
    }
    catch (error) {
        if (["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(String(error.code)))
            return [];
        throw error;
    }
};
const addresses = async (resolver, host, count) => {
    if (++count.used > 12)
        throw new Error("DNS lookup budget exceeded");
    try {
        return (await deadline(resolver.resolveAddresses(host))).slice(0, 20);
    }
    catch (error) {
        if (["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(String(error.code)))
            return [];
        throw error;
    }
};
function ip4Matches(ip, mechanism) {
    const [network, widthText] = mechanism.split("/");
    const width = widthText === undefined ? 32 : Number(widthText);
    if (isIP(network) !== 4 || !Number.isInteger(width) || width < 0 || width > 32)
        throw new Error("Unsupported or malformed SPF ip4 mechanism");
    if (isIP(ip) !== 4)
        return false;
    const asNumber = (value) => value.split(".").reduce((sum, octet) => (sum << 8) | Number(octet), 0);
    const mask = width === 0 ? 0 : (0xffffffff << (32 - width)) >>> 0;
    return ((asNumber(ip) & mask) >>> 0) === ((asNumber(network) & mask) >>> 0);
}
function validateSpfPolicy(record) {
    const terms = record.trim().split(/\s+/).slice(1);
    if (terms.length > 30)
        return "unknown";
    let terminal = false, redirects = 0, uncertain = false;
    for (const raw of terms) {
        if (/^redirect=/.test(raw)) {
            redirects++;
            try {
                spfHost(raw.slice(9));
            }
            catch {
                return "malformed";
            }
            continue;
        }
        const term = raw.replace(/^[+~?-]/, "");
        if (term === "all") {
            if (terminal)
                return "malformed";
            terminal = true;
        }
        else if (term.startsWith("ip4:")) {
            try {
                ip4Matches("0.0.0.0", term.slice(4));
            }
            catch {
                return "malformed";
            }
        }
        else if (term.startsWith("include:")) {
            try {
                spfHost(term.slice(8));
            }
            catch {
                return "malformed";
            }
        }
        else if (term === "a") { /* Supported A/AAAA lookup without CIDR. */ }
        else
            uncertain = true;
    }
    if (redirects > 1)
        return "malformed";
    return uncertain ? "unknown" : null;
}
async function evaluateSpf(domain, ip, resolver, count, visited) {
    if (visited.has(domain) || visited.size >= 5)
        return "unknown";
    visited.add(domain);
    const records = (await txt(resolver, domain, count)).filter(record => /^v=spf1(?:\s|$)/i.test(record));
    if (records.length !== 1)
        return "malformed";
    const policy = validateSpfPolicy(records[0]);
    if (policy)
        return policy;
    let uncertain = false;
    let redirect;
    for (const raw of records[0].trim().split(/\s+/).slice(1)) {
        if (raw.startsWith("redirect=")) {
            redirect = raw.slice(9);
            continue;
        }
        const qualifier = /^[+~?-]/.test(raw) ? raw[0] : "+";
        const term = /^[+~?-]/.test(raw) ? raw.slice(1) : raw;
        let matched = false;
        if (term.startsWith("ip4:")) {
            try {
                matched = ip4Matches(ip, term.slice(4));
            }
            catch {
                return "malformed";
            }
        }
        else if (term.startsWith("include:")) {
            let child;
            try {
                child = spfHost(term.slice(8));
            }
            catch {
                return "malformed";
            }
            const result = await evaluateSpf(child, ip, resolver, count, visited);
            if (result === "pass")
                matched = true;
            else if (result !== "fail")
                uncertain = true;
        }
        else if (term === "all")
            matched = true;
        else if (term === "a") {
            const found = await addresses(resolver, domain, count);
            matched = found.includes(ip);
        }
        else
            uncertain = true; // MX, exists, macros, ip6 and other mechanisms cannot be inferred safely.
        if (matched)
            return uncertain ? "unknown" : qualifier === "+" ? "pass" : "fail";
    }
    if (redirect && !records[0].trim().split(/\s+/).some(term => term.replace(/^[+~?-]/, "") === "all")) {
        try {
            return await evaluateSpf(spfHost(redirect), ip, resolver, count, visited);
        }
        catch {
            return "unknown";
        }
    }
    return uncertain ? "unknown" : "fail";
}
export async function inspectPrivateSmtp(input, resolver = readinessResolver) {
    const domain = normalizeCustomDomain(input.domain);
    const ip = input.outboundIp?.trim();
    if (ip && !publicIp(ip))
        throw Object.assign(new Error("A public outbound IP is required"), { status: 400 });
    const selector = input.dkimSelector?.trim().toLowerCase();
    if (selector && !validSelector(selector))
        throw Object.assign(new Error("Invalid DKIM selector"), { status: 400 });
    const count = { used: 0 };
    const safe = async (key, task) => {
        try {
            return await task();
        }
        catch {
            return check(key, "inconclusive", "DNS lookup did not complete or returned an unsupported answer.", "Check DNS availability with your DNS host, then recheck.");
        }
    };
    const result = [];
    result.push(await safe("address", async () => {
        const found = await addresses(resolver, domain, count);
        return found.length
            ? check("address", "pass", "Sending domain has A/AAAA records.", "No action needed. A/AAAA alone does not prove outgoing mail authorization.")
            : check("address", "inconclusive", "No A/AAAA record found; sending domains need not host a website.", "If you expect a website here, add its public A/AAAA record at your DNS host.");
    }));
    result.push(await safe("spf", async () => {
        const records = (await txt(resolver, domain, count)).filter(record => /^v=spf1(?:\s|$)/i.test(record));
        if (!records.length)
            return check("spf", "needs-fix", "No SPF record found.", "Publish one v=spf1 TXT record for the sending domain at your DNS host.");
        if (records.length !== 1 || validateSpfPolicy(records[0]) === "malformed")
            return check("spf", "needs-fix", "SPF has multiple records or malformed syntax.", "Keep exactly one syntactically valid SPF TXT record at your DNS host.");
        if (!ip)
            return check("spf", "inconclusive", "SPF record exists; authorization cannot be tested without the actual outbound IP.", "Enter the real public IP used by your MTA to send mail, then recheck.");
        const verdict = await evaluateSpf(domain, ip, resolver, count, new Set());
        return verdict === "pass"
            ? check("spf", "pass", "SPF authorizes the supplied outbound IP.", "No action needed; envelope sender alignment was not tested.")
            : verdict === "fail" || verdict === "malformed"
                ? check("spf", "needs-fix", verdict === "malformed" ? "SPF policy is malformed or ambiguous." : "SPF does not authorize the supplied outbound IP.", "Correct the single SPF TXT record at your DNS host to authorize the actual sending IP.")
                : check("spf", "inconclusive", "SPF contains mechanisms that cannot be safely evaluated here.", "Check the complete SPF policy and actual envelope sender at your DNS host/MTA.");
    }));
    result.push(await safe("dmarc", async () => {
        const records = (await txt(resolver, `_dmarc.${domain}`, count)).filter(record => /^v=DMARC1(?:\s*;|$)/i.test(record));
        if (!records.length)
            return check("dmarc", "inconclusive", "No DMARC policy at this subdomain; an organizational policy may apply.", "Check the organizational domain DMARC policy or publish a record at _dmarc.{{domain}} in DNS.");
        const policy = dmarcPolicy(records[0]);
        if (records.length !== 1 || policy === "malformed")
            return check("dmarc", "needs-fix", "DMARC policy is duplicated or malformed.", "Fix the single TXT policy at _dmarc.{{domain}}; include v=DMARC1 and p=none, quarantine or reject.");
        if (policy === "unknown")
            return check("dmarc", "inconclusive", "DMARC record contains tags this checker does not validate.", "Review every DMARC tag with your DNS administrator; alignment still requires real signed mail.");
        return check("dmarc", "pass", "DMARC policy syntax is present. Alignment and enforcement were not tested.", "Verify SPF/DKIM alignment with real messages on your MTA separately.");
    }));
    result.push(!selector ? check("dkim", "inconclusive", "DKIM selector not supplied.", "Enter the selector your MTA signs with, then recheck.")
        : await safe("dkim", async () => {
            const host = `${selector}._domainkey.${domain}`;
            const records = (await txt(resolver, host, count)).filter(record => /(?:^|;)\s*(?:v=DKIM1|p=)(?:[^;]*)(?:;|$)/i.test(record));
            if (!records.length)
                return check("dkim", "needs-fix", "No DKIM public key found at the supplied selector.", "Publish the public DKIM TXT key at {{host}} with your DNS host; configure the matching private key on your MTA.");
            const record = records[0] ?? "";
            const tags = parseTags(record);
            const key = tags?.get("p");
            const algorithm = tags?.get("k")?.toLowerCase() ?? "rsa";
            let validKey = false;
            if ((!tags?.has("v") || /^v=DKIM1(?:\s*;|$)/i.test(record)) && key && /^[A-Za-z0-9+/]+={0,2}$/.test(key) &&
                Buffer.from(key, "base64").toString("base64").replace(/=+$/, "") === key.replace(/=+$/, "")) {
                const bytes = Buffer.from(key, "base64");
                if (algorithm === "ed25519")
                    validKey = bytes.length === 32;
                else if (algorithm === "rsa") {
                    for (const type of ["pkcs1", "spki"]) {
                        try {
                            validKey = createPublicKey({ key: bytes, format: "der", type }).asymmetricKeyType === "rsa";
                        }
                        catch { /* Try the other standard RSA public-key representation. */ }
                        if (validKey)
                            break;
                    }
                }
            }
            if (records.length !== 1 || !validKey)
                return check("dkim", "needs-fix", "DKIM public key is duplicated, revoked or malformed.", "Correct the DKIM TXT record at {{host}} in DNS.");
            if ([...tags.keys()].some(tag => !["v", "p", "k"].includes(tag)))
                return check("dkim", "inconclusive", "DKIM record has additional tags this checker does not validate.", "Review DKIM record restrictions and key type with your DNS host and MTA.");
            return check("dkim", "pass", "DKIM public key is published; actual message signing was not tested.", "Confirm outgoing mail is signed with this selector on your MTA.");
        }));
    result.push(!ip ? check("ptr", "inconclusive", "Actual outbound public IP not supplied.", "Enter the real outbound IP assigned to your MTA, then recheck.")
        : await safe("ptr", async () => {
            if (++count.used > 12)
                throw new Error("DNS budget");
            let names;
            try {
                names = (await deadline(resolver.reverse(ip))).slice(0, 10);
            }
            catch (error) {
                if (!["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(String(error.code)))
                    throw error;
                names = [];
            }
            for (const name of names) {
                let host;
                try {
                    host = normalizeCustomDomain(name);
                }
                catch {
                    continue;
                }
                const forwards = await addresses(resolver, host, count);
                if (forwards.includes(ip))
                    return check("ptr", "pass", "PTR hostname resolves forward to the supplied outbound IP.", "No action needed. Confirm the supplied IP is actually used by your MTA.");
            }
            return check("ptr", "needs-fix", "No PTR hostname resolves forward to the supplied outbound IP.", "Ask your server/IP provider to set reverse DNS (PTR); publish matching A/AAAA DNS for that hostname.");
        }));
    return result;
}
//# sourceMappingURL=private-smtp-readiness.js.map