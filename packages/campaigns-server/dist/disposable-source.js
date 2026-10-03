import { readFileSync } from "node:fs";
import { domainToASCII } from "node:url";
export const DISPOSABLE_SOURCE_URL = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
export const MAILCHECKER_SOURCE_URL = "https://raw.githubusercontent.com/FGRibreau/mailchecker/master/list.txt";
const MAX_BYTES = 2 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
export function parseDisposableList(text) {
    if (Buffer.byteLength(text) > MAX_BYTES)
        throw new Error("Disposable list is too large");
    const domains = new Set();
    for (const line of text.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith("#"))
            continue;
        const domain = domainToASCII(value).toLowerCase();
        if (!domain || domain.length > 253 || !domain.includes(".") ||
            domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
            throw new Error("Disposable list contains an invalid domain");
        domains.add(domain);
    }
    if (domains.size < 1000 || domains.size > 100000)
        throw new Error("Disposable list size is outside the accepted range");
    // Fail closed on upstream corruption that would flag ordinary mail providers.
    if (["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com", "proton.me", "com", "co.uk"].some(domain => domains.has(domain)))
        throw new Error("Disposable list contains a protected mail domain");
    return domains;
}
export const primaryDisposableDomains = parseDisposableList(readFileSync(new URL("../data/disposable_email_blocklist.conf", import.meta.url), "utf8"));
export const mailcheckerDisposableDomains = parseDisposableList(readFileSync(new URL("../data/mailchecker-list.txt", import.meta.url), "utf8"));
export const bundledDisposableDomains = new Set([...primaryDisposableDomains, ...mailcheckerDisposableDomains]);
export function matchesDisposableDomain(domain, domains) {
    const parts = domain.toLowerCase().split(".");
    return parts.some((_, i) => i < parts.length - 1 && domains.has(parts.slice(i).join(".")));
}
const time = (value) => value ? new Date(value).toISOString() : null;
const stores = new WeakMap();
export function disposableSource(db) {
    let source = stores.get(db);
    if (!source) {
        source = new DisposableSource(db);
        stores.set(db, source);
    }
    return source;
}
export class DisposableSource {
    fetcher;
    domains = bundledDisposableDomains;
    primary;
    secondary;
    previousPrimary;
    previousSecondary;
    constructor(db, fetcher = fetch) {
        this.fetcher = fetcher;
        // Forward at call time so isolated tests can inject a transport, never patch global fetch.
        const transport = (...args) => this.fetcher(...args);
        this.primary = new DisposableSourceCache(db, transport, "disposable_source", DISPOSABLE_SOURCE_URL, primaryDisposableDomains);
        this.secondary = new DisposableSourceCache(db, transport, "disposable_mailchecker_source", MAILCHECKER_SOURCE_URL, mailcheckerDisposableDomains);
    }
    async load(force = false) {
        await Promise.all([this.primary.load(force), this.secondary.load(force)]);
        if (this.previousPrimary !== this.primary.domains || this.previousSecondary !== this.secondary.domains) {
            this.domains = new Set([...this.primary.domains, ...this.secondary.domains]);
            this.previousPrimary = this.primary.domains;
            this.previousSecondary = this.secondary.domains;
        }
    }
    async status() {
        await this.load();
        const primary = await this.primary.status(), secondary = await this.secondary.status();
        return { ...primary, domainCount: this.domains.size, bundled: primary.bundled || secondary.bundled,
            lastError: [primary.lastError, secondary.lastError].filter(Boolean).join(" ") || null };
    }
    async refresh(manual = false) {
        // Both settle before returning, including errors. An unavailable upstream
        // cannot prevent the other source updating or erase its last-good copy.
        const results = await Promise.allSettled([this.primary.refresh(manual), this.secondary.refresh(manual)]);
        await this.load(true);
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected")
            throw failure.reason;
        return this.status();
    }
}
class DisposableSourceCache {
    db;
    fetcher;
    table;
    url;
    bundledDomains;
    domains;
    loadedAt = 0;
    loadPromise;
    nextPoll = 0;
    state;
    constructor(db, fetcher, table, url, bundledDomains) {
        this.db = db;
        this.fetcher = fetcher;
        this.table = table;
        this.url = url;
        this.bundledDomains = bundledDomains;
        this.domains = bundledDomains;
        this.state = { sourceUrl: url, domainCount: bundledDomains.size,
            checkedAt: null, updatedAt: null, lastError: null, bundled: true, nextCheckAt: null };
    }
    async load(force = false) {
        if (!force && Date.now() - this.loadedAt < 60000)
            return;
        if (this.loadPromise)
            return this.loadPromise;
        this.loadPromise = (async () => {
            const row = (await this.db.query(`SELECT * FROM campaigns.${this.table} WHERE singleton=true`)).rows[0];
            if (row) {
                this.domains = row.domains ? new Set(row.domains) : this.bundledDomains;
                this.state = { sourceUrl: this.url, domainCount: this.domains.size, checkedAt: time(row.checked_at),
                    updatedAt: time(row.updated_at), lastError: row.last_error, bundled: !row.domains, nextCheckAt: time(row.next_check_at) };
            }
            this.loadedAt = Date.now();
        })().finally(() => { this.loadPromise = undefined; });
        return this.loadPromise;
    }
    async status() { await this.load(); return { ...this.state }; }
    async refresh(manual = false) {
        if (!manual && Date.now() < this.nextPoll)
            return this.status();
        this.nextPoll = Date.now() + 60000;
        const client = await this.db.connect?.();
        if (!client)
            throw new Error("Disposable updates require PostgreSQL");
        try {
            await client.query("BEGIN");
            const lock = (await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked", [this.table === "disposable_source" ? "campaigns-disposable-source" : "campaigns-mailchecker-source"])).rows[0];
            if (!lock.locked) {
                await client.query("COMMIT");
                if (manual)
                    throw Object.assign(new Error("A disposable list update is already running"), { status: 429 });
                return this.status();
            }
            await client.query(`INSERT INTO campaigns.${this.table}(singleton) VALUES(true) ON CONFLICT DO NOTHING`);
            const row = (await client.query(`SELECT * FROM campaigns.${this.table} WHERE singleton=true`)).rows[0];
            const now = Date.now();
            if (manual && row.checked_at && now - new Date(row.checked_at).getTime() < 60000)
                throw Object.assign(new Error("Wait one minute before checking again"), { status: 429 });
            if (!manual && row.next_check_at && new Date(row.next_check_at).getTime() > now) {
                await client.query("COMMIT");
                return this.status();
            }
            let response;
            const controller = new AbortController();
            const deadline = setTimeout(() => controller.abort(), 10000);
            try {
                response = await this.fetcher(this.url, {
                    signal: controller.signal, redirect: "error",
                    headers: { "User-Agent": "SendRepute-Campaigns/Email-Hygiene", Accept: "text/plain",
                        ...(row.etag && row.domains ? { "If-None-Match": row.etag } : {}) },
                });
                if (response.status === 304 && row.domains) {
                    await client.query(`UPDATE campaigns.${this.table} SET checked_at=now(),next_check_at=$1,last_error=NULL WHERE singleton=true`, [new Date(now + DAY)]);
                }
                else {
                    if (response.status !== 200 || !response.body)
                        throw new Error("Invalid source response");
                    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
                        throw new Error("List is too large");
                    const reader = response.body.getReader();
                    const chunks = [];
                    let size = 0;
                    try {
                        for (;;) {
                            const { value, done } = await reader.read();
                            if (done)
                                break;
                            size += value.byteLength;
                            if (size > MAX_BYTES) {
                                await reader.cancel();
                                throw new Error("List is too large");
                            }
                            chunks.push(value);
                        }
                    }
                    finally {
                        reader.releaseLock();
                    }
                    const domains = parseDisposableList(Buffer.concat(chunks).toString("utf8"));
                    await client.query(`UPDATE campaigns.${this.table} SET domains=$1,etag=$2,checked_at=now(),
            updated_at=now(),next_check_at=$3,last_error=NULL WHERE singleton=true`, [[...domains], (response.headers.get("etag") ?? "").slice(0, 512) || null, new Date(now + DAY)]);
                }
            }
            catch {
                // Persist the failure and retry budget without replacing the usable set.
                await client.query(`UPDATE campaigns.${this.table} SET checked_at=now(),next_check_at=$1,
          last_error='Source update failed; the last usable list is still active.' WHERE singleton=true`, [new Date(now + DAY)]);
            }
            finally {
                clearTimeout(deadline);
                controller.abort();
                if (response?.body && !response.body.locked)
                    await response.body.cancel().catch(() => { });
            }
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
        await this.load(true);
        return { ...this.state };
    }
}
//# sourceMappingURL=disposable-source.js.map