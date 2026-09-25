import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parsePolicy(value) {
    if (value !== "unconfirmed" && value !== "inactive")
        throw Object.assign(new Error("Invalid housekeeping policy"), { status: 400 });
    return value;
}
function parseCutoff(value, now) {
    if (typeof value !== "string")
        throw Object.assign(new Error("cutoff must be RFC3339"), { status: 400 });
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() - 86_400_000)
        throw Object.assign(new Error("cutoff must be at least 24 hours old"), { status: 400 });
    return parsed.toISOString();
}
function candidateClause(policy) {
    return policy === "unconfirmed"
        ? `body->>'status'='pending' AND coalesce((body->>'confirmedAt')::timestamptz,created_at)<$2::timestamptz`
        : `body->>'status' IN ('unsubscribed','bounced','complained') AND coalesce((body->>'updatedAt')::timestamptz,updated_at)<$2::timestamptz`;
}
function candidateDigest(ids) {
    return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}
function encodeToken(secret, value) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function decodeToken(secret, token) {
    if (typeof token !== "string" || token.length > 4096)
        throw Object.assign(new Error("Invalid confirmation token"), { status: 400 });
    const [payload, signature] = token.split(".");
    if (!payload || !signature)
        throw Object.assign(new Error("Invalid confirmation token"), { status: 400 });
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw Object.assign(new Error("Invalid confirmation token"), { status: 400 });
    try {
        return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    }
    catch {
        throw Object.assign(new Error("Invalid confirmation token"), { status: 400 });
    }
}
export async function cancelQueuedSubscriberJobs(db, subscriberIds, actorId, reason) {
    if (!subscriberIds.length)
        return 0;
    const cancelled = await db.query(`UPDATE campaigns.jobs SET state='cancelled',updated_at=now(),revision=revision+1
      WHERE recipient_id=ANY($1::uuid[]) AND state='queued'
      RETURNING id,campaign_id,recipient_id`, [[...subscriberIds]]);
    for (const job of cancelled.rows) {
        await db.query(`INSERT INTO campaigns.delivery_events(id,job_id,campaign_id,recipient_id,event_type,source,actor_id,metadata,occurred_at)
       VALUES($1,$2,$3,$4,'cancelled','operator',$5,$6,now()) ON CONFLICT DO NOTHING`, [randomUUID(), job.id, job.campaign_id, job.recipient_id, actorId, { reason }]);
    }
    return cancelled.rows.length;
}
export function createHousekeepingRouter(deps) {
    const router = Router();
    router.post("/housekeeping/preview", deps.mutation, deps.need("housekeeping:manage"), deps.wrap(async (request, response) => {
        const body = deps.json(request.body);
        deps.fields(body, ["policy", "cutoff", "page", "pageSize"], ["policy", "cutoff"]);
        const policy = parsePolicy(body.policy), cutoff = parseCutoff(body.cutoff, deps.now()), scope = await deps.scope();
        const requestedSize = body.pageSize === undefined ? 25 : Number(body.pageSize);
        const requestedPage = body.page === undefined ? 1 : Number(body.page);
        if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > 100 || !Number.isInteger(requestedPage) || requestedPage < 1)
            throw deps.http(400, "Invalid page");
        const all = await deps.db.query(`SELECT id,body->>'email' email FROM campaigns.entities
       WHERE kind='subscribers' AND body->>'scope'=$1 AND ${candidateClause(policy)}
       ORDER BY id LIMIT 10001`, [scope, cutoff]);
        if (all.rows.length > 10_000)
            throw deps.http(409, "Housekeeping preview exceeds 10000 candidates; choose an older bounded policy window");
        const ids = all.rows.map(row => row.id);
        await deps.assertSubscriberIdsAllowed(request, ids);
        const jobs = ids.length ? await deps.db.query("SELECT state,count(*)::text count FROM campaigns.jobs WHERE recipient_id=ANY($1::uuid[]) AND state IN ('queued','sending','unknown') GROUP BY state", [ids]) : { rows: [] };
        const jobCounts = Object.fromEntries(jobs.rows.map(row => [row.state, Number(row.count)]));
        const offset = (requestedPage - 1) * requestedSize;
        const candidates = all.rows.slice(offset, offset + requestedSize).map(row => ({
            id: row.id,
            maskedEmail: String(row.email).replace(/^(.).*(@.*)$/, "$1***$2"),
        }));
        const expiresAt = new Date(deps.now().getTime() + 15 * 60_000).toISOString();
        const confirmationToken = encodeToken(deps.secret, { scope, actorId: request.user.id, policy, cutoff, digest: candidateDigest(ids), expiresAt });
        response.json({ data: { policy, cutoff, total: ids.length, candidates, jobs: { queued: jobCounts.queued ?? 0, sending: jobCounts.sending ?? 0, unknown: jobCounts.unknown ?? 0 }, confirmationToken, expiresAt }, meta: { page: requestedPage, pageSize: requestedSize, total: ids.length } });
    }));
    router.post("/housekeeping/execute", deps.mutation, deps.need("housekeeping:manage"), deps.wrap(async (request, response) => {
        const body = deps.json(request.body);
        deps.fields(body, ["policy", "cutoff", "confirmation", "confirmationToken", "limit"], ["policy", "cutoff", "confirmation", "confirmationToken"]);
        if (body.confirmation !== "EXECUTE_HOUSEKEEPING")
            throw deps.http(400, "Invalid confirmation");
        const policy = parsePolicy(body.policy), cutoff = parseCutoff(body.cutoff, deps.now()), scope = await deps.scope();
        const limit = body.limit === undefined ? 500 : Number(body.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500)
            throw deps.http(400, "limit must be 1-500");
        const token = decodeToken(deps.secret, body.confirmationToken);
        if (token.scope !== scope || token.actorId !== request.user.id || token.policy !== policy || token.cutoff !== cutoff || new Date(String(token.expiresAt)).getTime() < deps.now().getTime())
            throw deps.http(409, "Confirmation token does not match this request or has expired");
        const client = deps.db.connect ? await deps.db.connect() : undefined;
        const tx = (client ?? deps.db);
        let deleted = 0, cancelledJobs = 0, blocked = 0, remaining = 0, candidateCount = 0;
        try {
            await tx.query("BEGIN");
            const candidates = await tx.query(`SELECT id FROM campaigns.entities WHERE kind='subscribers' AND body->>'scope'=$1
         AND ${candidateClause(policy)} ORDER BY id FOR UPDATE`, [scope, cutoff]);
            const ids = candidates.rows.map(row => row.id);
            candidateCount = ids.length;
            if (candidateDigest(ids) !== token.digest)
                throw deps.http(409, "Candidate set changed; preview again");
            await deps.assertSubscriberIdsAllowed(request, ids, tx);
            const selected = ids.slice(0, limit);
            const blockedRows = selected.length ? await tx.query("SELECT DISTINCT recipient_id FROM campaigns.jobs WHERE recipient_id=ANY($1::uuid[]) AND state IN ('sending','sent','unknown')", [selected]) : { rows: [] };
            const blockedIds = new Set(blockedRows.rows.map(row => row.recipient_id));
            blocked = blockedIds.size;
            const safeIds = selected.filter(id => !blockedIds.has(id));
            cancelledJobs = await cancelQueuedSubscriberJobs(tx, safeIds, request.user.id, `housekeeping_${policy}`);
            if (safeIds.length) {
                await tx.query("DELETE FROM campaigns.tokens WHERE subscriber_id=ANY($1::uuid[]) AND (consumed_at IS NOT NULL OR expires_at<=now())", [safeIds]);
                deleted = Number((await tx.query("DELETE FROM campaigns.entities WHERE kind='subscribers' AND id=ANY($1::uuid[])", [safeIds])).rowCount ?? 0);
            }
            remaining = candidateCount - deleted;
            await tx.query(`INSERT INTO campaigns.housekeeping_runs
        (id,scope,actor_id,policy,cutoff,candidate_count,deleted_count,cancelled_job_count,blocked_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), scope, request.user.id, policy, cutoff, candidateCount, deleted, cancelledJobs, blocked]);
            await deps.refreshListCounts(tx);
            await tx.query("COMMIT");
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            client?.release();
        }
        await deps.audit(request, "housekeeping.execute", "subscribers", null, { policy, cutoff, candidateCount, deleted, cancelledJobs, blocked, remaining });
        response.json({ data: { candidateCount, deleted, cancelledJobs, blocked, remaining } });
    }));
    return router;
}
//# sourceMappingURL=housekeeping.js.map