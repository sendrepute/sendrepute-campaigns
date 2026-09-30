import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const API_URL = "https://api.github.com/repos/sendrepute/sendrepute-campaigns/releases/latest";
const RELEASE_URL = "https://github.com/sendrepute/sendrepute-campaigns/releases/tag/";
const MAX_BYTES = 128 * 1024;
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
        return parsed.href;
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
    const asset = (name) => assets.find((entry) => entry && typeof entry === "object" && entry.name === name &&
        officialAsset(entry.browser_download_url, tag, name));
    const zip = asset(`${base}.zip`);
    const tar = asset(`${base}.tar.gz`);
    const checksums = asset(`${base}-SHA256SUMS`);
    const downloadUrl = (zip ?? tar)?.browser_download_url;
    const checksumUrl = checksums?.browser_download_url;
    const status = comparison > 0 && downloadUrl && checksumUrl ? "available" : comparison < 0 ? "ahead" : comparison === 0 ? "current" : "unavailable";
    return {
        currentVersion, latestVersion: tag, status,
        reason: comparison > 0 && (!downloadUrl || !checksumUrl) ? "Official archive or SHA-256 checksums are missing from the release assets" : null,
        publishedAt: release.published_at,
        notes: typeof release.body === "string" ? release.body.slice(0, 4000) : null,
        releaseUrl, downloadUrl: status === "available" ? downloadUrl : null,
        checksumUrl: status === "available" ? checksumUrl : null,
    };
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
            const response = await fetcher(API_URL, {
                signal: controller.signal, redirect: "manual",
                headers: { Accept: "application/vnd.github+json", "User-Agent": "SendRepute-Campaigns-update-check", ...(previous?.etag ? { "If-None-Match": previous.etag } : {}) },
            });
            if (response.url && response.url !== API_URL)
                throw new Error("Unexpected GitHub API redirect");
            if (response.status === 304 && previous) {
                const value = interpretRelease(previous.payload, currentVersion);
                cached = { ...previous, at: now, value };
                failed.delete(currentVersion);
                return value;
            }
            if (response.status === 429 || response.status === 403)
                throw new Error("GitHub rate limit or access restriction");
            if (!response.ok)
                throw new Error(`GitHub release check failed (HTTP ${response.status})`);
            const length = Number(response.headers.get("content-length"));
            if (length > MAX_BYTES)
                throw new Error("GitHub release response too large");
            if (!response.body)
                throw new Error("Empty GitHub release response");
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > MAX_BYTES) {
                    await reader.cancel();
                    throw new Error("GitHub release response too large");
                }
                chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            const payload = JSON.parse(new TextDecoder().decode(bytes));
            const value = interpretRelease(payload, currentVersion);
            cached = { at: now, payload, value, etag: response.headers.get("etag") };
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