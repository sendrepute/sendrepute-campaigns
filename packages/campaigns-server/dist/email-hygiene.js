import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { bundledDisposableDomains, matchesDisposableDomain } from "./disposable-source.js";
const roles = new Set(["admin", "abuse", "postmaster", "support", "info", "sales", "contact", "noreply", "no-reply"]);
export function emailDomain(address) {
    return domainToASCII(address.slice(address.lastIndexOf("@") + 1)).toLowerCase();
}
export function checkEmailBasic(address, now = new Date(), disposableDomains = bundledDisposableDomains) {
    const value = typeof address === "string" ? address.trim() : "";
    const checkedAt = now.toISOString();
    const invalid = () => ({ status: "invalid", reasons: ["syntax_invalid"], checkedAt });
    if (!value || /[\s\u0000-\u001f\u007f]/u.test(value))
        return invalid();
    const at = value.lastIndexOf("@");
    if (at <= 0 || at === value.length - 1)
        return invalid();
    const local = value.slice(0, at), domain = emailDomain(value);
    if (!domain || domain.length > 253 || !domain.includes(".") ||
        domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
        return invalid();
    if (Buffer.byteLength(local) > 64 || Buffer.byteLength(`${local}@${domain}`) > 254)
        return invalid();
    // Do not claim unusual but potentially valid RFC/SMTPUTF8 addresses invalid.
    if (local.startsWith('"') || /[^\x00-\x7f]/.test(local))
        return { status: "unknown", reasons: ["syntax_unsupported"], checkedAt };
    if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes(".."))
        return invalid();
    const reasons = [];
    if (matchesDisposableDomain(domain, disposableDomains))
        reasons.push("disposable");
    if (roles.has(local.toLowerCase()))
        reasons.push("role_address");
    return { status: reasons.length ? "risky" : "passed", reasons: reasons.length ? reasons : ["syntax_ok"], checkedAt };
}
const absent = (error) => ["ENODATA", "ENOTFOUND"].includes(String(error?.code));
export function createMailDnsResolver() {
    return new Resolver({ timeout: 2000, tries: 1 });
}
/** Domain configuration only. No SMTP connections, mail sending or mailbox claims. */
export async function checkMailDomain(domain, resolver = createMailDnsResolver()) {
    const checkedAt = new Date().toISOString();
    const result = (status, reason) => ({ status, reasons: [reason], checkedAt });
    try {
        const mx = await resolver.resolveMx(domain);
        if (mx.length) {
            // A sole priority-zero root exchange is RFC 7505 null MX.
            if (mx.length === 1 && mx[0].priority === 0 && ["", "."].includes(mx[0].exchange))
                return result("invalid", "domain_no_mail");
            if (mx.some(record => !record.exchange || record.exchange === "."))
                return result("unknown", "domain_unknown");
            return result("passed", "domain_mx");
        }
    }
    catch (error) {
        if (!absent(error))
            return result("unknown", "domain_unknown");
        if (error.code === "ENOTFOUND")
            return result("invalid", "domain_not_found");
    }
    // RFC 5321 implicit MX: absence of MX alone is not a reason to reject mail.
    const addresses = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    if (addresses.some(item => item.status === "fulfilled" && item.value.length))
        return result("passed", "domain_implicit_mx");
    if (addresses.some(item => item.status === "rejected" && !absent(item.reason)))
        return result("unknown", "domain_unknown");
    return result("invalid", "domain_no_mail");
}
export function combineHygieneChecks(basic, domain, duplicate = false) {
    const reasons = [...new Set([...basic.reasons, ...(domain?.reasons ?? []), ...(duplicate ? ["duplicate"] : [])])];
    const status = basic.status === "invalid" || domain?.status === "invalid" ? "invalid"
        : domain?.status === "unknown" || basic.status === "unknown" ? "unknown"
            : duplicate || basic.status === "risky" ? "risky" : "passed";
    return { status, reasons, checkedAt: domain?.checkedAt ?? basic.checkedAt };
}
//# sourceMappingURL=email-hygiene.js.map