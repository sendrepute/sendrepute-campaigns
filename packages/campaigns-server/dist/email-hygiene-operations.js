import { randomUUID } from "node:crypto";
import { Router } from "express";
import { cancelQueuedSubscriberJobs } from "./housekeeping.js";
import { checkEmailBasic, checkMailDomain, combineHygieneChecks, emailDomain } from "./email-hygiene.js";
import { disposableSource } from "./disposable-source.js";
import { registerDeletedSubscribers } from "./deleted-subscribers.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serialize = (row) => ({
    id: row.id, listId: row.list_id, mode: row.mode, state: row.state,
    processed: row.processed, createdAt: row.created_at, updatedAt: row.updated_at,
});
export function createEmailHygieneRouter(deps) {
    const router = Router();
    const { db, wrap } = deps;
    registerDeletedSubscribers(router, deps);
    router.get("/email-hygiene/source", deps.need("subscribers:manage"), wrap(async (_request, response) => {
        response.json({ data: await disposableSource(db).status() });
    }));
    const owned = async (request) => {
        if (!UUID.test(String(request.params.id)))
            throw deps.http(400, "Invalid operation ID");
        const row = (await db.query("SELECT * FROM campaigns.email_hygiene_runs WHERE id=$1 AND actor_id=$2 AND scope=$3", [request.params.id, request.user.id, await deps.scope()])).rows[0];
        if (!row)
            throw deps.http(404, "Email check not found");
        deps.assertListsAllowed(request, [row.list_id]);
        return row;
    };
    router.get("/email-hygiene/runs", deps.need("subscribers:manage"), wrap(async (request, response) => {
        const allowed = deps.restrictedLists(request);
        const rows = await db.query(`SELECT * FROM campaigns.email_hygiene_runs WHERE actor_id=$1 AND scope=$2
       AND ($3::jsonb IS NULL OR $3::jsonb ? list_id::text) ORDER BY created_at DESC LIMIT 50`, [request.user.id, await deps.scope(), allowed === null ? null : JSON.stringify(allowed)]);
        response.json({ data: rows.rows.map(serialize) });
    }));
    router.post("/email-hygiene/runs", deps.mutation, deps.need("subscribers:manage"), wrap(async (request, response) => {
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).some(key => !["listId", "mode"].includes(key)) ||
            !UUID.test(String(body.listId)) || !["basic", "dns"].includes(body.mode))
            throw deps.http(400, "Choose a list and a basic or DNS check");
        deps.assertListsAllowed(request, [body.listId]);
        if (!(await db.query("SELECT 1 FROM campaigns.entities WHERE kind='lists' AND id=$1", [body.listId])).rowCount)
            throw deps.http(404, "List not found");
        // Only an explicit Start check triggers a source check, at most once per
        // rolling day across all users/processes. Ordinary imports remain local.
        await disposableSource(db).refresh();
        const client = await db.connect?.();
        if (!client)
            throw deps.http(503, "Email checks require PostgreSQL");
        let run;
        try {
            await client.query("BEGIN");
            // Scope-wide admission lock prevents concurrent requests bypassing the cap.
            await client.query("SELECT pg_advisory_xact_lock(hashtext('campaigns-email-hygiene'))");
            const scope = await deps.scope();
            const active = await client.query("SELECT count(*)::int total FROM campaigns.email_hygiene_runs WHERE scope=$1 AND state IN ('queued','running')", [scope]);
            if (active.rows[0].total >= 5)
                throw deps.http(409, "Finish or remove an active email check before starting another");
            const allowed = deps.restrictedLists(request);
            run = (await client.query(`INSERT INTO campaigns.email_hygiene_runs(id,actor_id,scope,list_id,allowed_lists,mode)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(), request.user.id, scope, body.listId, allowed === null ? null : JSON.stringify(allowed), body.mode])).rows[0];
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
        await deps.audit(request, "email_hygiene.start", "email_hygiene", run.id, { mode: body.mode });
        response.status(201).json({ data: serialize(run) });
    }));
    router.get("/email-hygiene/runs/:id", deps.need("subscribers:manage"), wrap(async (request, response) => {
        const run = await owned(request);
        const { page, pageSize, offset } = deps.page(request);
        const allowed = deps.restrictedLists(request);
        // Re-evaluate current access to each subscriber, even when assignments have
        // changed since the run. Reports never reveal removed/now-inaccessible rows.
        const clause = `r.run_id=$1 AND e.kind='subscribers' AND e.id=r.subscriber_id
      AND e.body->>'scope'=$2 AND ($3::jsonb IS NULL OR
      (jsonb_array_length(e.body->'listIds')>0 AND e.body->'listIds' <@ $3::jsonb))`;
        const params = [run.id, run.scope, allowed === null ? null : JSON.stringify(allowed)];
        const total = (await db.query(`SELECT count(*)::int total FROM campaigns.email_hygiene_results r
      JOIN campaigns.entities e ON e.id=r.subscriber_id WHERE ${clause}`, params)).rows[0].total;
        const results = await db.query(`SELECT r.subscriber_id "subscriberId",r.email,r.status,r.reasons,r.checked_at "checkedAt"
      FROM campaigns.email_hygiene_results r JOIN campaigns.entities e ON e.id=r.subscriber_id
      WHERE ${clause} ORDER BY r.subscriber_id LIMIT $4 OFFSET $5`, [...params, pageSize, offset]);
        const invalidCount = (await db.query(`SELECT count(*)::int total FROM campaigns.email_hygiene_results r
      JOIN campaigns.entities e ON e.id=r.subscriber_id WHERE ${clause}
      AND r.status='invalid' AND e.body->>'email'=r.email AND e.body->'listIds' ? $4`, [...params, run.list_id])).rows[0].total;
        response.json({ data: serialize(run), results: results.rows, invalidCount, meta: { page, pageSize, total } });
    }));
    router.post("/email-hygiene/runs/:id/delete-invalid", deps.mutation, deps.need("subscribers:manage"), wrap(async (request, response) => {
        if (request.body?.confirmation !== "DELETE_INVALID_SUBSCRIBERS" || Object.keys(request.body).some(key => key !== "confirmation"))
            throw deps.http(400, "Explicit deletion confirmation is required");
        const ownedRun = await owned(request);
        const client = await db.connect?.();
        if (!client)
            throw deps.http(503, "Email checks require PostgreSQL");
        let deleted = 0, cancelledJobs = 0, skipped = 0;
        try {
            await client.query("BEGIN");
            const run = (await client.query("SELECT * FROM campaigns.email_hygiene_runs WHERE id=$1 FOR UPDATE", [ownedRun.id])).rows[0];
            if (!run)
                throw deps.http(404, "Email check not found");
            if (run.state !== "completed")
                throw deps.http(409, "Wait for the check to complete before deleting subscribers");
            const allowed = deps.restrictedLists(request);
            // Lock current identities, not just old results. Edited addresses, moved
            // contacts, inaccessible contacts, risky and unknown findings are excluded.
            const candidates = await client.query(`SELECT e.id FROM campaigns.entities e
        JOIN campaigns.email_hygiene_results r ON r.subscriber_id=e.id
        WHERE r.run_id=$1 AND r.status='invalid' AND e.kind='subscribers'
        AND e.body->>'scope'=$2 AND e.body->>'email'=r.email AND e.body->'listIds' ? $3
        AND ($4::jsonb IS NULL OR (jsonb_array_length(e.body->'listIds')>0 AND e.body->'listIds' <@ $4::jsonb))
        ORDER BY EXISTS (SELECT 1 FROM campaigns.jobs j WHERE j.recipient_id=e.id AND j.state IN ('sending','sent','unknown')), e.id LIMIT 500 FOR UPDATE OF e`, [run.id, run.scope, run.list_id, allowed === null ? null : JSON.stringify(allowed)]);
            let ids = candidates.rows.map(row => row.id);
            if (ids.length) {
                const tx = { query: client.query.bind(client) };
                await deps.assertSubscriberIdsAllowed(request, ids, tx);
                const blocked = await client.query("SELECT DISTINCT recipient_id FROM campaigns.jobs WHERE recipient_id=ANY($1::uuid[]) AND state IN ('sending','sent','unknown')", [ids]);
                const protectedIds = new Set(blocked.rows.map(row => row.recipient_id));
                skipped = protectedIds.size;
                ids = ids.filter(id => !protectedIds.has(id));
                cancelledJobs = await cancelQueuedSubscriberJobs(tx, ids, request.user.id, "email_hygiene_delete_invalid");
                await client.query(`INSERT INTO campaigns.deleted_subscribers(id,subscriber_id,scope,body,original_created_at,reasons)
          SELECT gen_random_uuid(),e.id,$2,e.body,e.created_at,r.reasons
          FROM campaigns.entities e JOIN campaigns.email_hygiene_results r ON r.subscriber_id=e.id
          WHERE e.id=ANY($1::uuid[]) AND r.run_id=$3`, [ids, run.scope, run.id]);
                await client.query("DELETE FROM campaigns.tokens WHERE subscriber_id=ANY($1::uuid[])", [ids]);
                deleted = (await client.query("DELETE FROM campaigns.entities WHERE kind='subscribers' AND id=ANY($1::uuid[])", [ids])).rowCount ?? 0;
                if (deleted !== ids.length)
                    throw deps.http(409, "Subscriber set changed; retry");
                await deps.refreshListCounts(tx);
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
        await deps.audit(request, "email_hygiene.delete_invalid", "email_hygiene", ownedRun.id, { deleted, cancelledJobs, skipped });
        response.json({ data: { deleted, cancelledJobs, skipped } });
    }));
    router.delete("/email-hygiene/runs/:id", deps.mutation, deps.need("subscribers:manage"), wrap(async (request, response) => {
        const run = await owned(request);
        await db.query("DELETE FROM campaigns.email_hygiene_runs WHERE id=$1 AND actor_id=$2", [run.id, request.user.id]);
        await deps.audit(request, "email_hygiene.delete", "email_hygiene", run.id);
        response.status(204).end();
    }));
    return router;
}
/**
 * Small, resumable, read-only contact scan. One locked batch per worker tick,
 * no dependency on an open browser. Crash/rollback replays the same cursor.
 * DNS concurrency is four and cached only inside this batch.
 */
export async function advanceEmailHygiene(db, domainCheck = checkMailDomain) {
    const source = disposableSource(db);
    await source.load();
    await db.query("DELETE FROM campaigns.email_hygiene_runs WHERE created_at < now()-interval '30 days'");
    const client = await db.connect?.();
    if (!client)
        return;
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout='15s'");
        const run = (await client.query("SELECT * FROM campaigns.email_hygiene_runs WHERE state IN ('queued','running') ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
        if (!run) {
            await client.query("COMMIT");
            return;
        }
        const rows = (await client.query(`SELECT e.id,e.body,EXISTS(
        SELECT 1 FROM campaigns.entities d WHERE d.kind='subscribers' AND d.id<>e.id
        AND d.body->>'scope'=e.body->>'scope' AND lower(trim(d.body->>'email'))=lower(trim(e.body->>'email'))
        AND ($5::jsonb IS NULL OR (jsonb_array_length(d.body->'listIds')>0 AND d.body->'listIds' <@ $5::jsonb))
       ) duplicate FROM campaigns.entities e WHERE e.kind='subscribers' AND e.body->>'scope'=$1
       AND e.body->'listIds' ? $2 AND ($3::uuid IS NULL OR e.id>$3)
       AND e.created_at<=$4
       AND ($5::jsonb IS NULL OR (jsonb_array_length(e.body->'listIds')>0 AND e.body->'listIds' <@ $5::jsonb))
       ORDER BY e.id LIMIT 20`, [run.scope, run.list_id, run.cursor_id, run.created_at, run.allowed_lists === null ? null : JSON.stringify(run.allowed_lists)])).rows;
        const cache = new Map();
        for (let i = 0; i < rows.length; i += 4) {
            const batch = await Promise.all(rows.slice(i, i + 4).map(async (row) => {
                const basic = checkEmailBasic(row.body.email, new Date(), source.domains);
                let domain;
                if (run.mode === "dns" && basic.status !== "invalid" && !basic.reasons.includes("syntax_unsupported")) {
                    const hostname = emailDomain(String(row.body.email));
                    if (!cache.has(hostname))
                        cache.set(hostname, domainCheck(hostname));
                    domain = await cache.get(hostname);
                }
                return { row, check: combineHygieneChecks(basic, domain, row.duplicate) };
            }));
            for (const { row, check } of batch)
                await client.query(`INSERT INTO campaigns.email_hygiene_results(run_id,subscriber_id,email,status,reasons,checked_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,subscriber_id) DO NOTHING`, [run.id, row.id, row.body.email, check.status, JSON.stringify(check.reasons), check.checkedAt]);
        }
        await client.query(`UPDATE campaigns.email_hygiene_runs SET cursor_id=COALESCE($2,cursor_id),
      processed=processed+$3,state=$4,updated_at=now() WHERE id=$1`, [run.id, rows.at(-1)?.id ?? null, rows.length, rows.length < 20 ? "completed" : "running"]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=email-hygiene-operations.js.map