import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const REPOSITORY_API = "https://api.github.com/repos/sendrepute/sendrepute-campaigns";
const API_URL = `${REPOSITORY_API}/releases/latest`;
const RELEASE_URL = "https://github.com/sendrepute/sendrepute-campaigns/releases/tag/";
const MAX_BYTES = 128 * 1024;
const MAX_TAG_BYTES = 16 * 1024;
const MAX_CHECKSUM_BYTES = 1024;
const MISSING_ASSETS_REASON = "Official archive or SHA-256 checksums are missing from the release assets";
const TTL_MS = 15 * 60 * 1000;
export const MANUAL_COOLDOWN_MS = 60 * 1000;
const versionFile = join(dirname(fileURLToPath(import.meta.url)), "..", "release-version.json");
export function installedReleaseVersion(file = versionFile) {
    try {
        if (!existsSync(file))
            return null;
        const version = JSON.parse(readFileSync(file, "utf8")).version;
        return typeof version === "string" && parseVersion(version) ? version : null;
    }
    catch {
        return null;
    }
}
function parseVersion(value) {
    if (typeof value !== "string" || !/^(?:v)?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value))
        return null;
    return value.replace(/^v/, "").split(".").map(Number);
}
function officialAsset(url, tag, name) {
    if (typeof url !== "string")
        return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password ||
            parsed.search || parsed.hash || parsed.pathname !== `/sendrepute/sendrepute-campaigns/releases/download/${tag}/${name}`)
            return null;
        return url === parsed.href ? parsed.href : null;
    }
    catch {
        return null;
    }
}
export function interpretRelease(payload, currentVersion) {
    if (!payload || typeof payload !== "object")
        throw new Error("Invalid GitHub release response");
    const release = payload;
    const tag = release.tag_name;
    const latest = parseVersion(tag);
    if (!latest || typeof tag !== "string" || release.draft !== false || release.prerelease !== false)
        throw new Error("Latest GitHub release is not a stable semantic version");
    const releaseUrl = `${RELEASE_URL}${tag}`;
    if (release.html_url !== releaseUrl || typeof release.published_at !== "string" ||
        !Number.isFinite(Date.parse(release.published_at)) || !Array.isArray(release.assets))
        throw new Error("Invalid GitHub release metadata");
    const current = parseVersion(currentVersion);
    if (!current)
        return { currentVersion: null, latestVersion: tag, status: "unavailable", reason: "Installed release version is unknown; comparison is not possible", publishedAt: release.published_at, notes: null, releaseUrl, downloadUrl: null, checksumUrl: null };
    const comparison = latest[0] - current[0] || latest[1] - current[1] || latest[2] - current[2];
    const base = `sendrepute-campaigns-${tag.replace(/^v/, "")}`;
    const assets = release.assets;
    const names = [`${base}.zip`, `${base}.tar.gz`, `${base}-SHA256SUMS`];
    const seen = new Set();
    let invalidAssets = false;
    for (const entry of assets) {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string")
            throw new Error("Invalid GitHub release asset metadata");
        const asset = entry;
        const name = asset.name;
        if (!names.includes(name))
            continue;
        // A present but invalid/duplicate expected asset must never become permission
        // to use the repository fallback, even if the other archive is valid.
        if (seen.has(name) || !officialAsset(asset.browser_download_url, tag, name) ||
            (asset.size !== undefined && (!Number.isSafeInteger(asset.size) || asset.size <= 0)) ||
            (asset.state !== undefined && asset.state !== "uploaded") ||
            (asset.digest !== undefined && asset.digest !== null &&
                (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest))))
            invalidAssets = true;
        seen.add(name);
    }
    const asset = (name) => assets.find((entry) => entry.name === name);
    const zip = asset(`${base}.zip`);
    const tar = asset(`${base}.tar.gz`);
    const checksums = asset(`${base}-SHA256SUMS`);
    const downloadUrl = (zip ?? tar)?.browser_download_url;
    const checksumUrl = checksums?.browser_download_url;
    const status = comparison > 0 && !invalidAssets && downloadUrl && checksumUrl ? "available" : comparison < 0 ? "ahead" : comparison === 0 ? "current" : "unavailable";
    return {
        currentVersion, latestVersion: tag, status,
        reason: comparison > 0 ? invalidAssets ? "Invalid official GitHub release asset metadata; repository fallback is not permitted" :
            (!downloadUrl || !checksumUrl) ? MISSING_ASSETS_REASON : null : null,
        publishedAt: release.published_at,
        notes: typeof release.body === "string" ? release.body.slice(0, 4000) : null,
        releaseUrl, downloadUrl: status === "available" ? downloadUrl : null,
        checksumUrl: status === "available" ? checksumUrl : null,
    };
}
function cancelBody(response) {
    // Cleanup must not extend the request deadline if a remote stream stalls.
    if (response.body && !response.body.locked)
        void response.body.cancel().catch(() => { });
}
function abortable(pending, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("GitHub release check timed out"));
        if (signal.aborted) {
            void pending.catch(() => { });
            abort();
            return;
        }
        signal.addEventListener("abort", abort, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
async function boundedResponse(response, maxBytes, label, signal) {
    const rawLength = response.headers.get("content-length");
    if (rawLength !== null && !/^\d+$/.test(rawLength)) {
        cancelBody(response);
        throw new Error(`Invalid ${label} content length`);
    }
    const length = rawLength === null ? null : Number(rawLength);
    if (length !== null && (!Number.isSafeInteger(length) || length > maxBytes)) {
        cancelBody(response);
        throw new Error(`${label} response too large`);
    }
    if (!response.body)
        throw new Error(`Empty ${label} response`);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await abortable(reader.read(), signal);
            if (done)
                break;
            size += value.byteLength;
            if (size > maxBytes)
                throw new Error(`${label} response too large`);
            chunks.push(value);
        }
        const encoding = response.headers.get("content-encoding");
        if (length !== null && (!encoding || encoding === "identity") && size !== length)
            throw new Error(`Truncated ${label} response (content length mismatch)`);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    catch (error) {
        void reader.cancel().catch(() => { });
        throw error;
    }
    finally {
        reader.releaseLock();
    }
}
async function fixedResponse(url, fetcher, signal, etag) {
    const pending = fetcher(url, {
        signal, redirect: "manual",
        headers: { Accept: url.startsWith(`${REPOSITORY_API}/`) ? "application/vnd.github+json" : "text/plain",
            "User-Agent": "SendRepute-Campaigns-update-check", "Accept-Encoding": "identity",
            ...(etag ? { "If-None-Match": etag } : {}) },
    });
    // A transport that resolves after our deadline must not retain its body.
    void pending.then(response => { if (signal.aborted)
        cancelBody(response); }, () => { });
    const response = await abortable(pending, signal);
    try {
        if (response.redirected || (response.url && response.url !== url))
            throw new Error("Unexpected GitHub API or repository redirect");
        if (response.status === 304 && url === API_URL && etag)
            return response;
        if (response.status >= 300 && response.status < 400)
            throw new Error("Unexpected GitHub API or repository redirect");
        if (response.status === 429 || response.status === 403)
            throw new Error("GitHub rate limit or access restriction");
        // Partial or otherwise unexpected success responses are not complete metadata.
        if (response.status !== 200)
            throw new Error(`GitHub release check failed (HTTP ${response.status})`);
        return response;
    }
    catch (error) {
        cancelBody(response);
        throw error;
    }
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid official GitHub tag metadata");
    return value;
}
function officialGitObject(value, type) {
    const object = record(value);
    if (object.type !== type || typeof object.sha !== "string" || !/^[a-f0-9]{40}$/.test(object.sha) ||
        object.url !== `${REPOSITORY_API}/git/${type === "commit" ? "commits" : "tags"}/${object.sha}`)
        throw new Error("Invalid official GitHub tag commit or repository");
    return object.sha;
}
async function repositoryDownloads(tag, fetcher, signal) {
    // Neither URLs nor repository identity are taken from upstream payloads.
    const refUrl = `${REPOSITORY_API}/git/ref/tags/${tag}`;
    const ref = record(JSON.parse(await boundedResponse(await fixedResponse(refUrl, fetcher, signal), MAX_TAG_BYTES, "GitHub tag", signal)));
    if (ref.ref !== `refs/tags/${tag}` || ref.url !== `${REPOSITORY_API}/git/refs/tags/${tag}`)
        throw new Error("Invalid official GitHub release tag or repository");
    const object = record(ref.object);
    let commit;
    if (object.type === "tag") {
        const sha = officialGitObject(object, "tag");
        const tagUrl = `${REPOSITORY_API}/git/tags/${sha}`;
        const annotated = record(JSON.parse(await boundedResponse(await fixedResponse(tagUrl, fetcher, signal), MAX_TAG_BYTES, "GitHub annotated tag", signal)));
        if (annotated.sha !== sha || annotated.url !== tagUrl || annotated.tag !== tag)
            throw new Error("Invalid official GitHub annotated release tag");
        // Nested tags are intentionally rejected: at most one bounded peel request.
        commit = officialGitObject(annotated.object, "commit");
    }
    else {
        commit = officialGitObject(object, "commit");
    }
    const base = `sendrepute-campaigns-${tag.replace(/^v/, "")}`;
    const root = `https://raw.githubusercontent.com/sendrepute/sendrepute-campaigns/${commit}/downloads/`;
    const checksumUrl = `${root}${base}-SHA256SUMS`;
    const manifest = await boundedResponse(await fixedResponse(checksumUrl, fetcher, signal), MAX_CHECKSUM_BYTES, "GitHub checksum manifest", signal);
    // Match the packager's complete two-line format, including its final newline.
    // No paths, duplicate names, comments, alternate versions or partial hashes.
    const expected = new Set([`${base}.zip`, `${base}.tar.gz`]);
    const lines = manifest.endsWith("\n") ? manifest.slice(0, -1).split("\n") : [];
    if (lines.length !== 2)
        throw new Error("Invalid or truncated official SHA-256 checksum manifest");
    for (const line of lines) {
        const match = /^([a-f0-9]{64})  ([a-z0-9.-]+)$/.exec(line);
        if (!match || !expected.delete(match[2]))
            throw new Error("Invalid official SHA-256 checksum manifest filename or digest");
    }
    if (expected.size)
        throw new Error("Missing official archive SHA-256 checksums");
    return { tag, downloadUrl: `${root}${base}.zip`, checksumUrl };
}
async function resolveRelease(payload, currentVersion, fetcher, signal, previousDownloads) {
    const value = interpretRelease(payload, currentVersion);
    if (value.status !== "unavailable" || value.reason !== MISSING_ASSETS_REASON)
        return { value };
    const tag = value.latestVersion;
    const downloads = previousDownloads?.tag === tag ? previousDownloads : await repositoryDownloads(tag, fetcher, signal);
    return { value: { ...value, status: "available", reason: null, downloadUrl: downloads.downloadUrl, checksumUrl: downloads.checksumUrl }, downloads };
}
let cached;
const inFlight = new Map();
const failed = new Map();
let lastManualAt = -Infinity;
export class ManualCheckCooldownError extends Error {
    constructor() { super("Please wait one minute before checking again."); }
}
export async function checkRelease(currentVersion = installedReleaseVersion(), fetcher = fetch, now = Date.now(), force = false) {
    // Manual requests share the same upstream budget across all users and installed versions.
    // Coalesce simultaneous requests before evaluating the cooldown.
    const pending = inFlight.get(currentVersion);
    if (pending)
        return pending;
    if (force) {
        if (now - lastManualAt < MANUAL_COOLDOWN_MS)
            throw new ManualCheckCooldownError();
        lastManualAt = now; // Charge even failed requests; do not allow retries to flood GitHub.
    }
    if (!force && cached && now - cached.at < TTL_MS && cached.value.currentVersion === currentVersion)
        return cached.value;
    const previousFailure = failed.get(currentVersion);
    if (!force && previousFailure && now - previousFailure.at < 60_000)
        throw new Error(previousFailure.message);
    const previous = cached;
    const request = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        try {
            const response = await fixedResponse(API_URL, fetcher, controller.signal, previous?.etag);
            if (response.status === 304 && previous) {
                cancelBody(response);
                const { value, downloads } = await resolveRelease(previous.payload, currentVersion, fetcher, controller.signal, previous.downloads);
                cached = { ...previous, at: now, value, downloads: downloads ?? previous.downloads };
                failed.delete(currentVersion);
                return value;
            }
            const payload = JSON.parse(await boundedResponse(response, MAX_BYTES, "GitHub release", controller.signal));
            const { value, downloads } = await resolveRelease(payload, currentVersion, fetcher, controller.signal);
            cached = { at: now, payload, value, etag: response.headers.get("etag"), downloads };
            failed.delete(currentVersion);
            return value;
        }
        catch (error) {
            failed.set(currentVersion, { at: now, message: error instanceof Error ? error.message : "GitHub release check failed" });
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    })().finally(() => { inFlight.delete(currentVersion); });
    inFlight.set(currentVersion, request);
    return request;
}
//# sourceMappingURL=release-update.js.map