import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { promises as dns } from "node:dns";
import { Router } from "express";
const VERIFY_PREFIX = "sendrepute-domain-verification=";
const PIXEL = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");
const RESERVED_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion"];
function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}
function privateAddress(value) {
    const address = value.toLowerCase().split("%")[0];
    if (address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") ||
        address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb") ||
        address.startsWith("ff") || /^2001:0?db8(?::|$)/.test(address))
        return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    const candidate = mapped ?? address;
    if (isIP(candidate) !== 4)
        return false;
    const [a, b] = candidate.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
        (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
        (a === 203 && b === 0);
}
export function normalizeCustomDomain(value) {
    if (typeof value !== "string")
        throw httpError(400, "Domain must be a hostname");
    const input = value.trim().replace(/\.$/, "").toLowerCase();
    const hostname = domainToASCII(input);
    if (!hostname || hostname.length > 253 || isIP(hostname) || !hostname.includes(".") ||
        RESERVED_SUFFIXES.some(suffix => hostname === suffix.slice(1) || hostname.endsWith(suffix)) ||
        hostname.split(".").some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        throw httpError(400, "A public DNS hostname is required");
    }
    return hostname;
}
export function normalizeBasePath(value) {
    if (value === undefined || value === null || value === "")
        return "/";
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("?") || value.includes("#") || value.includes("\\")) {
        throw httpError(400, "Base path must be an absolute URL path");
    }
    let normalized;
    try {
        const parts = value.split("/").filter(Boolean).map(part => decodeURIComponent(part));
        if (parts.some(part => part === "." || part === ".."))
            throw new Error("dot segment");
        normalized = `/${parts.map(part => encodeURIComponent(part)).join("/")}`;
    }
    catch {
        throw httpError(400, "Base path must contain valid URL encoding");
    }
    return normalized === "/" ? "/" : `${normalized}/`;
}
export function verificationRecordName(hostname) {
    return `_sendrepute.${normalizeCustomDomain(hostname)}`;
}
export function verificationRecordValue(challenge) {
    return `${VERIFY_PREFIX}${challenge}`;
}
export const systemDnsVerifier = {
    resolveTxt: hostname => dns.resolveTxt(hostname),
    async resolveAddresses(hostname) {
        const results = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
        return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    },
};
export async function verifyDomainChallenge(hostnameValue, challenge, resolver = systemDnsVerifier) {
    const hostname = normalizeCustomDomain(hostnameValue);
    let addresses;
    try {
        addresses = await resolver.resolveAddresses(hostname);
    }
    catch {
        throw httpError(422, "Domain does not resolve to a public host");
    }
    if (!addresses.length)
        throw httpError(422, "Domain does not resolve to a public host");
    if (addresses.some(address => !isIP(address) || privateAddress(address))) {
        throw httpError(422, "Domain resolves to a private or reserved address");
    }
    let records;
    try {
        records = await resolver.resolveTxt(verificationRecordName(hostname));
    }
    catch {
        throw httpError(422, "DNS verification TXT record was not found");
    }
    const expected = verificationRecordValue(challenge);
    if (!records.some(parts => parts.join("") === expected))
        throw httpError(422, "DNS verification TXT record was not found");
}
function safeStyle(value) {
    return /(?:expression|url\s*\(|@import|behavior|javascript:|-moz-binding)/i.test(value) ? "" : value;
}
function safeUrl(value, image) {
    const trimmed = value.trim();
    if (image && /^data:image\/(?:gif|png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed))
        return trimmed;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "https:" || (!image && (parsed.protocol === "http:" || parsed.protocol === "mailto:")))
            return parsed.toString();
    }
    catch { /* omit malformed and relative URLs */ }
    return "";
}
export function sanitizeWebVersionHtml(value) {
    const allowed = new Set(["a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "div", "em",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strong",
        "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"]);
    const withoutActive = String(value)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|iframe|object|embed|form|button|input|textarea|select|option|svg|math|template|video|audio)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<(script|style|iframe|object|embed|form|button|input|textarea|select|option|svg|math|template|video|audio|meta|base|link)\b[^>]*\/?>/gi, "");
    return withoutActive.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (whole, rawTag, rawAttrs) => {
        const tag = rawTag.toLowerCase();
        if (!allowed.has(tag))
            return "";
        if (whole.startsWith("</"))
            return `</${tag}>`;
        const attrs = [];
        const permitted = new Set(["align", "alt", "aria-label", "bgcolor", "border", "cellpadding", "cellspacing", "class",
            "colspan", "height", "role", "rowspan", "title", "valign", "width"]);
        for (const match of rawAttrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
            const name = match[1].toLowerCase();
            const raw = match[2] ?? match[3] ?? match[4] ?? "";
            let cleaned = "";
            if (permitted.has(name))
                cleaned = raw;
            else if (name === "style")
                cleaned = safeStyle(raw);
            else if (tag === "a" && name === "href")
                cleaned = safeUrl(raw, false);
            else if (tag === "img" && name === "src")
                cleaned = safeUrl(raw, true);
            if (cleaned)
                attrs.push(`${name}="${cleaned.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`);
        }
        if (tag === "a")
            attrs.push('rel="noopener noreferrer"');
        return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
    });
}
export function validateStoredDestination(value) {
    if (typeof value !== "string" || value.length > 8192)
        throw httpError(400, "Click destination must be an HTTP(S) URL");
    let destination;
    try {
        destination = new URL(value);
    }
    catch {
        throw httpError(400, "Click destination must be an HTTP(S) URL");
    }
    if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) {
        throw httpError(400, "Click destination must be an HTTP(S) URL without credentials");
    }
    return destination.toString();
}
function tokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}
function issueToken(key, scope) {
    const opaque = randomBytes(24).toString("base64url");
    const signature = createHmac("sha256", key).update(`${scope}:${opaque}`).digest("base64url");
    return `${opaque}.${signature}`;
}
function validSignature(key, scope, token) {
    const [opaque, supplied, extra] = token.split(".");
    if (!opaque || !supplied || extra || !/^[A-Za-z0-9_-]+$/.test(opaque))
        return false;
    const expected = createHmac("sha256", key).update(`${scope}:${opaque}`).digest();
    let actual;
    try {
        actual = Buffer.from(supplied, "base64url");
    }
    catch {
        return false;
    }
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function trackingUrl(base, route) {
    const result = new URL(base.toString());
    result.pathname = `${result.pathname.replace(/\/?$/, "/")}${route.replace(/^\//, "")}`;
    result.search = "";
    result.hash = "";
    return result.toString();
}
async function selectBaseUrl(db, installationPublicUrl, domainId) {
    if (!domainId) {
        const base = new URL(installationPublicUrl);
        if (base.protocol !== "https:" || base.username || base.password)
            throw httpError(409, "Installation public URL must use HTTPS");
        return base;
    }
    const result = await db.query("SELECT hostname,base_path FROM campaigns.custom_domains WHERE id=$1 AND verified_at IS NOT NULL", [domainId]);
    const row = result.rows[0];
    if (!row)
        throw httpError(409, "Custom domain is not verified");
    return new URL(`https://${row.hostname}${normalizeBasePath(row.base_path)}`);
}
export async function createCampaignTrackingLinks(db, input) {
    if (Buffer.byteLength(input.signingKey) < 32)
        throw new Error("Tracking signing key must contain at least 32 bytes");
    if (typeof input.subject !== "string" || input.subject.length > 998)
        throw httpError(400, "Invalid campaign subject");
    const base = await selectBaseUrl(db, input.installationPublicUrl, input.domainId);
    const documentId = randomUUID();
    const trackingAllowed = input.trackingEnabled && !input.recipientTrackingOptOut;
    await db.query(`INSERT INTO campaigns.sent_documents
       (id,job_id,campaign_id,recipient_id,subject,html,text_content,tracking_allowed)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [documentId, input.jobId ?? null, input.campaignId ?? null, input.recipientId ?? null, input.subject,
        sanitizeWebVersionHtml(input.html), input.text ?? null, trackingAllowed]);
    const store = async (scope, destination, destinationKey, record) => {
        const token = issueToken(input.signingKey, scope);
        await db.query(`INSERT INTO campaigns.tracking_tokens
         (token_hash,document_id,scope,destination,destination_key,record_event,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`, [tokenHash(token), documentId, scope, destination, destinationKey, record, input.expiresAt ?? null]);
        return token;
    };
    const webToken = await store("webversion", null, null, false);
    const openToken = trackingAllowed ? await store("open", null, null, true) : null;
    const clicks = [];
    for (const [index, item] of (input.clicks ?? []).entries()) {
        const destination = validateStoredDestination(item.url);
        const key = item.key?.trim() || createHash("sha256").update(`${index}:${destination}`).digest("hex").slice(0, 24);
        if (key.length > 200)
            throw httpError(400, "Click key is too long");
        const token = await store("click", destination, key, trackingAllowed);
        clicks.push({ key, destination, url: trackingUrl(base, `public/campaigns/click/${token}`) });
    }
    return {
        documentId,
        webVersionUrl: trackingUrl(base, `public/campaigns/web/${webToken}`),
        openUrl: openToken ? trackingUrl(base, `public/campaigns/open/${openToken}.gif`) : null,
        clicks,
    };
}
export function createPostgresTrackingEventRecorder(db, onUniqueEvent) {
    return async (event) => {
        const inserted = await db.query(`INSERT INTO campaigns.tracking_event_ledger(document_id,event_type,event_key,occurred_at)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING document_id`, [event.documentId, event.type, event.key, event.occurredAt]);
        if (!inserted.rowCount)
            return false;
        await onUniqueEvent(event);
        return true;
    };
}
export function createDomainsTrackingRouter(deps) {
    if (Buffer.byteLength(deps.signingKey) < 32)
        throw new Error("Tracking signing key must contain at least 32 bytes");
    const router = Router();
    const fail = deps.http ?? httpError;
    const now = deps.now ?? (() => new Date());
    const resolver = deps.dns ?? systemDnsVerifier;
    const uuid = (value) => {
        if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
            throw fail(400, "Invalid domain ID");
        }
        return value;
    };
    const challenge = () => randomBytes(24).toString("base64url");
    const present = (row) => ({
        id: row.id, hostname: row.hostname, basePath: row.base_path, verifiedAt: row.verified_at,
        lastCheckedAt: row.last_checked_at, lastError: row.last_error,
        dns: { type: "TXT", name: verificationRecordName(row.hostname), value: verificationRecordValue(row.challenge) },
        tls: { required: true, configuredByApplication: false },
        createdAt: row.created_at, updatedAt: row.updated_at,
    });
    router.get("/domains", deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const p = deps.page(request);
        const rows = await deps.db.query("SELECT * FROM campaigns.custom_domains ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2", [p.pageSize, p.offset]);
        const count = await deps.db.query("SELECT count(*)::text count FROM campaigns.custom_domains");
        response.json({ data: rows.rows.map(present), meta: { page: p.page, pageSize: p.pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.post("/domains", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).some(key => !["hostname", "basePath"].includes(key)))
            throw fail(400, "Invalid domain configuration");
        const hostname = normalizeCustomDomain(body.hostname);
        const basePath = normalizeBasePath(body.basePath);
        const id = randomUUID();
        let result;
        try {
            result = await deps.db.query("INSERT INTO campaigns.custom_domains(id,hostname,base_path,challenge) VALUES($1,$2,$3,$4) RETURNING *", [id, hostname, basePath, challenge()]);
        }
        catch (error) {
            if (error?.code === "23505")
                throw fail(409, "Domain already exists");
            throw error;
        }
        await deps.audit(request, "domain.create", "custom_domain", id, { hostname, basePath });
        response.status(201).json({ data: present(result.rows[0]) });
    }));
    router.post("/domains/:id/rotate-challenge", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length) {
            throw fail(400, "Body must be an empty object");
        }
        const id = uuid(request.params.id);
        const result = await deps.db.query(`UPDATE campaigns.custom_domains SET challenge=$2,verified_at=NULL,last_checked_at=NULL,
         last_error=NULL,updated_at=$3 WHERE id=$1 RETURNING *`, [id, challenge(), now()]);
        if (!result.rows[0])
            throw fail(404, "Domain not found");
        await deps.audit(request, "domain.challenge.rotate", "custom_domain", id);
        response.json({ data: present(result.rows[0]) });
    }));
    router.post("/domains/:id/verify", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length) {
            throw fail(400, "Body must be an empty object");
        }
        const id = uuid(request.params.id);
        const row = (await deps.db.query("SELECT hostname,challenge FROM campaigns.custom_domains WHERE id=$1", [id])).rows[0];
        if (!row)
            throw fail(404, "Domain not found");
        try {
            await verifyDomainChallenge(row.hostname, row.challenge, resolver);
        }
        catch (error) {
            const message = error instanceof Error ? error.message.slice(0, 500) : "DNS verification failed";
            await deps.db.query("UPDATE campaigns.custom_domains SET verified_at=NULL,last_checked_at=$2,last_error=$3,updated_at=$2 WHERE id=$1", [id, now(), message]);
            throw error;
        }
        const checked = now();
        const result = await deps.db.query("UPDATE campaigns.custom_domains SET verified_at=$2,last_checked_at=$2,last_error=NULL,updated_at=$2 WHERE id=$1 RETURNING *", [id, checked]);
        await deps.audit(request, "domain.verify", "custom_domain", id, { hostname: row.hostname });
        response.json({ data: present(result.rows[0]) });
    }));
    router.delete("/domains/:id", deps.mutation, deps.need("settings:manage"), deps.wrap(async (request, response) => {
        const id = uuid(request.params.id);
        const result = await deps.db.query("DELETE FROM campaigns.custom_domains WHERE id=$1 RETURNING hostname", [id]);
        if (!result.rows[0])
            throw fail(404, "Domain not found");
        await deps.audit(request, "domain.delete", "custom_domain", id);
        response.json({ data: { deleted: true } });
    }));
    const resolveToken = async (token, scope) => {
        if (token.length > 256 || !validSignature(deps.signingKey, scope, token))
            throw fail(404, "Link not found");
        const result = await deps.db.query(`SELECT t.scope,t.destination,t.destination_key,t.record_event,t.expires_at,
         d.id document_id,d.job_id,d.campaign_id,d.recipient_id,d.subject,d.html,d.tracking_allowed
       FROM campaigns.tracking_tokens t JOIN campaigns.sent_documents d ON d.id=t.document_id
       WHERE t.token_hash=$1 AND t.scope=$2`, [tokenHash(token), scope]);
        const row = result.rows[0];
        if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= now().getTime()))
            throw fail(404, "Link not found");
        return row;
    };
    const privacyHeaders = (response) => {
        response.set("Cache-Control", "no-store, private");
        response.set("Referrer-Policy", "no-referrer");
        response.set("X-Content-Type-Options", "nosniff");
    };
    const record = async (row, type, key) => {
        if (!row.record_event || !row.tracking_allowed)
            return;
        await deps.recordEvent({
            documentId: row.document_id, jobId: row.job_id, campaignId: row.campaign_id,
            recipientId: row.recipient_id, type, key, occurredAt: now(),
        });
    };
    router.get("/public/campaigns/web/:token", deps.wrap(async (request, response) => {
        const row = await resolveToken(String(request.params.token), "webversion");
        privacyHeaders(response);
        response.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
        response.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${row.subject.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title></head><body>${row.html}</body></html>`);
    }));
    router.get("/public/campaigns/open/:token.gif", deps.wrap(async (request, response) => {
        const row = await resolveToken(String(request.params.token), "open");
        await record(row, "open", "open");
        privacyHeaders(response);
        response.type("image/gif").send(PIXEL);
    }));
    router.get("/public/campaigns/click/:token", deps.wrap(async (request, response) => {
        const row = await resolveToken(String(request.params.token), "click");
        if (!row.destination || !row.destination_key)
            throw fail(404, "Link not found");
        const destination = validateStoredDestination(row.destination);
        await record(row, "click", row.destination_key);
        privacyHeaders(response);
        response.redirect(302, destination);
    }));
    return router;
}
//# sourceMappingURL=domains-tracking.js.map