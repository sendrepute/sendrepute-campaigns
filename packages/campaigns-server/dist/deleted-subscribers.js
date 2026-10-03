export function registerDeletedSubscribers(router, deps) {
    const { db, wrap } = deps;
    router.get("/email-hygiene/deleted-subscribers", deps.need("subscribers:manage"), wrap(async (request, response) => {
        const { page, pageSize, offset } = deps.page(request);
        const allowed = deps.restrictedLists(request);
        const params = [await deps.scope(), allowed === null ? null : JSON.stringify(allowed)];
        const clause = `scope=$1 AND ($2::jsonb IS NULL OR
      (jsonb_array_length(body->'listIds')>0 AND body->'listIds' <@ $2::jsonb))`;
        const total = (await db.query(`SELECT count(*)::int total FROM campaigns.deleted_subscribers WHERE ${clause}`, params)).rows[0].total;
        const rows = await db.query(`SELECT id,body->>'email' email,reasons,deleted_at "deletedAt"
      FROM campaigns.deleted_subscribers WHERE ${clause}
      ORDER BY deleted_at DESC,id LIMIT $3 OFFSET $4`, [...params, pageSize, offset]);
        response.json({ data: rows.rows, meta: { page, pageSize, total } });
    }));
    router.post("/email-hygiene/deleted-subscribers/:id/restore", deps.mutation, deps.need("subscribers:manage"), wrap(async (request, response) => {
        if (!/^[0-9a-f-]{36}$/i.test(String(request.params.id)) ||
            request.body?.confirmation !== "RESTORE_SUBSCRIBER" ||
            Object.keys(request.body).some(key => key !== "confirmation"))
            throw deps.http(400, "Explicit restore confirmation is required");
        const client = await db.connect?.();
        if (!client)
            throw deps.http(503, "Subscriber recovery requires PostgreSQL");
        let subscriberId;
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(731946215)");
            const row = (await client.query(`SELECT * FROM campaigns.deleted_subscribers WHERE id=$1 AND scope=$2 FOR UPDATE`, [request.params.id, await deps.scope()])).rows[0];
            if (!row)
                throw deps.http(404, "Deleted subscriber not found");
            deps.assertListsAllowed(request, row.body.listIds);
            const restricted = deps.restrictedLists(request);
            if (restricted !== null && !row.body.listIds.length)
                throw deps.http(403, "Subscriber access denied");
            const lists = await client.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[]) FOR SHARE", [row.body.listIds]);
            if (lists.rows.length !== new Set(row.body.listIds).size)
                throw deps.http(409, "Restore the original lists before restoring this subscriber");
            if ((await client.query(`SELECT 1 FROM campaigns.entities WHERE id=$1 OR
        (kind='subscribers' AND body->>'scope'=$2 AND lower(btrim(body->>'email'))=lower(btrim($3))) LIMIT 1`, [row.subscriber_id, row.scope, row.body.email])).rowCount)
                throw deps.http(409, "This subscriber already exists; no records were overwritten");
            // Reinsertion is recovery, not a fresh signup or list enrollment. Preserve
            // consent/suppression exactly and never restart cancelled jobs/automations.
            await client.query("SELECT set_config('campaigns.restoring','true',true)");
            await client.query(`INSERT INTO campaigns.entities(id,kind,body,created_at,updated_at)
        VALUES($1,'subscribers',$2,$3,now())`, [row.subscriber_id, row.body, row.original_created_at]);
            await client.query("DELETE FROM campaigns.deleted_subscribers WHERE id=$1", [row.id]);
            await deps.refreshListCounts({ query: client.query.bind(client) });
            subscriberId = row.subscriber_id;
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            if (error.code === "23505")
                throw deps.http(409, "This subscriber already exists; no records were overwritten");
            throw error;
        }
        finally {
            client.release();
        }
        await deps.audit(request, "email_hygiene.restore", "subscribers", subscriberId);
        response.json({ data: { restored: true } });
    }));
}
//# sourceMappingURL=deleted-subscribers.js.map