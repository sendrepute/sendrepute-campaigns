import { randomUUID } from "node:crypto";
import { Router } from "express";
import { automationTransaction } from "./automations.js";
export async function appendDeliveryEvent(db, event) {
    const result = await db.query(`INSERT INTO campaigns.delivery_events
       (id,job_id,campaign_id,recipient_id,event_type,source,attempt,provider_message_id,
        provider_event_key,error_code,metadata,actor_id,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT DO NOTHING RETURNING id`, [randomUUID(), event.jobId, event.campaignId ?? null, event.recipientId ?? null,
        event.type, event.source, event.attempt ?? null, event.providerMessageId ?? null,
        event.providerEventKey ?? null, event.errorCode ?? null, event.metadata ?? {},
        event.actorId ?? null, event.occurredAt ?? new Date()]);
    return !!result.rowCount;
}
export async function refreshCampaignDeliveryStatistics(db, campaignId) {
    const result = await db.query(`SELECT
       count(DISTINCT job_id) FILTER (WHERE event_type IN ('accepted','reconciled_accepted'))::text accepted,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_delivered')::text delivered,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_opened')::text opened,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_clicked')::text clicked,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_bounced')::text bounced,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_soft_bounced')::text soft_bounced,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_complained')::text complaints,
       count(DISTINCT job_id) FILTER (WHERE event_type='provider_unsubscribed')::text unsubscribed
     FROM campaigns.delivery_events de
     WHERE campaign_id=$1
       AND EXISTS (SELECT 1 FROM campaigns.jobs j WHERE j.id=de.job_id AND j.kind='campaign')`, [campaignId]);
    const value = result.rows[0];
    await db.query(`UPDATE campaigns.entities SET body=jsonb_set(body,'{statistics}',
       coalesce(body->'statistics','{}'::jsonb)||$2::jsonb),updated_at=now()
     WHERE kind='campaigns' AND id=$1`, [campaignId, {
            sent: Number(value.accepted), delivered: Number(value.delivered), opened: Number(value.opened),
            clicked: Number(value.clicked), bounced: Number(value.bounced), softBounced: Number(value.soft_bounced),
            complaints: Number(value.complaints), unsubscribed: Number(value.unsubscribed),
        }]);
}
export function createDeliveryReliabilityRouter(deps) {
    const router = Router();
    const assertAutomationJobAllowed = async (request, id) => {
        if (!request.user || !Object.prototype.hasOwnProperty.call(request.user, "listIds"))
            return;
        const allowed = Array.isArray(request.user.listIds) ? request.user.listIds : [];
        const row = (await deps.db.query(`SELECT r.definition,s.body FROM campaigns.jobs j
       JOIN campaigns.automation_runs r ON r.id=j.automation_run_id
       LEFT JOIN campaigns.entities s ON s.kind='subscribers' AND s.id=r.subscriber_id WHERE j.id=$1`, [id])).rows[0];
        if (row && (!row.body || !row.body.listIds?.length || [...row.definition.listIds, ...row.body.listIds].some((v) => !allowed.includes(v))))
            throw deps.http(403, "Resource is outside your assigned lists");
    };
    const jobSelect = `SELECT j.id,j.campaign_id "campaignId",j.recipient_id "recipientId",j.kind,j.state,
    j.run_at "runAt",j.attempt_count "attemptCount",j.max_attempts "maxAttempts",
    j.next_attempt_at "nextAttemptAt",j.provider_message_id "providerMessageId",
    j.last_error_code "lastErrorCode",j.created_at "createdAt",j.updated_at "updatedAt",j.revision,
    j.snapshot->>'experimentId' "experimentId",j.snapshot->>'experimentArm' "experimentArm",
    j.snapshot->>'experimentVariant' "experimentVariant"
    FROM campaigns.jobs j`;
    router.get("/delivery/jobs", deps.need("delivery:reconcile"), deps.wrap(async (request, response) => {
        const p = deps.page(request);
        const state = request.query.state ? String(request.query.state) : null;
        const campaignId = request.query.campaignId ? String(request.query.campaignId) : null;
        const kind = request.query.kind ? String(request.query.kind) : null;
        if (kind && !["campaign", "test", "optin", "automation"].includes(kind))
            throw deps.http(400, "Invalid delivery job kind");
        if (campaignId)
            await deps.assertCampaignAllowed(request, campaignId);
        const args = [];
        const where = [];
        if (request.user && Object.prototype.hasOwnProperty.call(request.user, "listIds")) {
            args.push(JSON.stringify(Array.isArray(request.user.listIds) ? request.user.listIds : []));
            where.push(`(j.automation_run_id IS NULL OR EXISTS(SELECT 1 FROM campaigns.automation_runs r JOIN campaigns.entities s ON s.kind='subscribers' AND s.id=r.subscriber_id WHERE r.id=j.automation_run_id AND r.definition->'listIds' <@ $${args.length}::jsonb AND s.body->'listIds' <@ $${args.length}::jsonb))`);
        }
        if (state) {
            args.push(state);
            where.push(`j.state=$${args.length}`);
        }
        if (campaignId) {
            args.push(campaignId);
            where.push(`j.campaign_id=$${args.length}`);
        }
        if (kind) {
            args.push(kind);
            where.push(`j.kind=$${args.length}`);
        }
        args.push(p.pageSize, p.offset);
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const rows = await deps.db.query(`${jobSelect} ${clause} ORDER BY j.created_at DESC,j.id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
        const count = await deps.db.query(`SELECT count(*)::text count FROM campaigns.jobs j ${clause}`, args.slice(0, -2));
        response.json({ data: rows.rows, meta: { ...p, offset: undefined, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.get("/delivery/jobs/:jobId", deps.need("delivery:reconcile"), deps.wrap(async (request, response) => {
        await assertAutomationJobAllowed(request, String(request.params.jobId));
        const result = await deps.db.query(`${jobSelect} WHERE j.id=$1`, [String(request.params.jobId)]);
        const job = result.rows[0];
        if (!job)
            throw deps.http(404, "Delivery job not found");
        if (job.campaignId)
            await deps.assertCampaignAllowed(request, String(job.campaignId));
        const events = await deps.db.query(`SELECT id,event_type "type",source,attempt,provider_message_id "providerMessageId",
        error_code "errorCode",metadata,actor_id "actorId",occurred_at "occurredAt",recorded_at "recordedAt"
       FROM campaigns.delivery_events WHERE job_id=$1 ORDER BY occurred_at,id`, [request.params.jobId]);
        response.json({ data: { ...job, events: events.rows } });
    }));
    router.post("/delivery/jobs/:jobId/reconcile", deps.mutation, deps.need("delivery:reconcile"), deps.wrap(async (request, response) => {
        await assertAutomationJobAllowed(request, String(request.params.jobId));
        const body = deps.json(request.body);
        deps.fields(body, ["outcome", "confirmation", "note"], ["outcome", "confirmation"]);
        if (!["accepted", "rejected"].includes(String(body.outcome)))
            throw deps.http(400, "Outcome must be accepted or rejected");
        if (body.confirmation !== "RECONCILE_UNKNOWN_DELIVERY")
            throw deps.http(400, "Invalid confirmation");
        if ((await deps.db.query("SELECT 1 FROM campaigns.jobs WHERE id=$1 AND automation_run_id IS NOT NULL", [request.params.jobId])).rowCount) {
            const state = body.outcome === "accepted" ? "sent" : "rejected";
            await automationTransaction(deps.db, async (tx) => {
                const changed = await tx.query("UPDATE campaigns.jobs SET state=$2,updated_at=now(),revision=revision+1 WHERE id=$1 AND state='unknown' RETURNING recipient_id,attempt_count", [request.params.jobId, state]);
                const job = changed.rows[0];
                if (!job)
                    throw deps.http(409, "Only an unknown delivery can be reconciled");
                await tx.query("UPDATE campaigns.automation_runs SET state=$2,error='Delivery manually reconciled; journey stopped',updated_at=now() WHERE job_id=$1 AND state IN ('unknown','running')", [request.params.jobId, state === "sent" ? "completed" : "failed"]);
                await appendDeliveryEvent(tx, {
                    jobId: String(request.params.jobId), campaignId: null, recipientId: job.recipient_id,
                    type: body.outcome === "accepted" ? "reconciled_accepted" : "reconciled_rejected",
                    source: "operator", attempt: job.attempt_count, actorId: request.user.id,
                    metadata: body.note ? { note: String(body.note).slice(0, 1000) } : {},
                });
            });
            await deps.audit(request, "delivery.reconcile", "delivery_job", String(request.params.jobId), { outcome: body.outcome });
            response.json({ data: { id: request.params.jobId, state } });
            return;
        }
        const existing = await deps.db.query("SELECT campaign_id,kind FROM campaigns.jobs WHERE id=$1", [request.params.jobId]);
        if (!existing.rows[0])
            throw deps.http(404, "Delivery job not found");
        if (existing.rows[0].campaign_id)
            await deps.assertCampaignAllowed(request, existing.rows[0].campaign_id);
        const state = body.outcome === "accepted" ? "sent" : "rejected";
        const changed = await deps.db.query(`UPDATE campaigns.jobs SET state=$2,updated_at=now(),revision=revision+1
       WHERE id=$1 AND state='unknown'
       RETURNING campaign_id,recipient_id,attempt_count`, [request.params.jobId, state]);
        const job = changed.rows[0];
        if (!job)
            throw deps.http(409, "Only an unknown delivery can be reconciled");
        await appendDeliveryEvent(deps.db, {
            jobId: String(request.params.jobId), campaignId: job.campaign_id, recipientId: job.recipient_id,
            type: body.outcome === "accepted" ? "reconciled_accepted" : "reconciled_rejected",
            source: "operator", attempt: job.attempt_count, actorId: request.user.id,
            metadata: body.note ? { note: String(body.note).slice(0, 1000) } : {},
        });
        if (existing.rows[0].kind === "campaign" && job.campaign_id)
            await refreshCampaignDeliveryStatistics(deps.db, job.campaign_id);
        if (existing.rows[0].kind === "campaign" && job.campaign_id) {
            await deps.db.query(`UPDATE campaigns.entities e SET body=jsonb_set(body,'{status}',
           to_jsonb(CASE
             WHEN EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign' AND j.state IN ('queued','sending')) THEN 'sending'
             WHEN EXISTS(SELECT 1 FROM campaigns.jobs j WHERE j.campaign_id=e.id AND j.kind='campaign' AND j.state IN ('rejected','unknown')) THEN 'failed'
             ELSE 'sent' END::text)),updated_at=now()
         WHERE e.kind='campaigns' AND e.id=$1`, [job.campaign_id]);
        }
        await deps.audit(request, "delivery.reconcile", "delivery_job", String(request.params.jobId), { outcome: body.outcome });
        response.json({ data: { id: request.params.jobId, state } });
    }));
    router.post("/delivery/jobs/:jobId/retry", deps.mutation, deps.need("delivery:retry"), deps.wrap(async (request, response) => {
        await assertAutomationJobAllowed(request, String(request.params.jobId));
        if ((await deps.db.query("SELECT 1 FROM campaigns.jobs WHERE id=$1 AND automation_run_id IS NOT NULL", [request.params.jobId])).rowCount)
            throw deps.http(409, "Automation jobs cannot be manually retried; create a new explicit event after reviewing the outcome");
        const body = deps.json(request.body);
        deps.fields(body, ["confirmation"], ["confirmation"]);
        if (body.confirmation !== "RETRY_REJECTED_DELIVERY")
            throw deps.http(400, "Invalid confirmation");
        const existing = await deps.db.query("SELECT campaign_id,kind FROM campaigns.jobs WHERE id=$1", [request.params.jobId]);
        if (!existing.rows[0])
            throw deps.http(404, "Delivery job not found");
        if (existing.rows[0].campaign_id)
            await deps.assertCampaignAllowed(request, existing.rows[0].campaign_id);
        const changed = await deps.db.query(`UPDATE campaigns.jobs target SET state='queued',run_at=now(),next_attempt_at=now(),
         claimed_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=now(),revision=revision+1
       WHERE id=$1 AND state='rejected'
         AND automation_run_id IS NULL AND kind<>'automation'
         AND (kind<>'test' OR NOT EXISTS (
           SELECT 1 FROM campaigns.jobs active
           WHERE active.id<>target.id
             AND active.campaign_id IS NOT DISTINCT FROM target.campaign_id
             AND active.kind='test' AND active.state IN ('queued','sending')
             AND lower(active.snapshot->'subscriber'->>'email')=
                 lower(target.snapshot->'subscriber'->>'email')
         ))
       RETURNING campaign_id,recipient_id,attempt_count`, [request.params.jobId]);
        const job = changed.rows[0];
        if (!job)
            throw deps.http(409, "Only a definitively rejected delivery can be retried");
        if (existing.rows[0].kind === "campaign" && job.campaign_id) {
            await deps.db.query(`UPDATE campaigns.entities SET body=jsonb_set(body,'{status}','"sending"'::jsonb),updated_at=now()
         WHERE kind='campaigns' AND id=$1 AND body->>'status'='failed'`, [job.campaign_id]);
        }
        await appendDeliveryEvent(deps.db, {
            jobId: String(request.params.jobId), campaignId: job.campaign_id, recipientId: job.recipient_id,
            type: "explicit_retry", source: "operator", attempt: job.attempt_count, actorId: request.user.id,
        });
        await deps.audit(request, "delivery.retry", "delivery_job", String(request.params.jobId));
        response.status(202).json({ data: { id: request.params.jobId, state: "queued" } });
    }));
    router.get("/reports/delivery", deps.need("read"), deps.wrap(async (request, response) => {
        const campaignId = request.query.campaignId ? String(request.query.campaignId) : null;
        const page = deps.page(request);
        if (campaignId)
            await deps.assertCampaignAllowed(request, campaignId);
        const result = await deps.db.query(`WITH relevant AS (
         SELECT de.* FROM campaigns.delivery_events de
         JOIN campaigns.jobs j ON j.id=de.job_id AND j.kind='campaign'
         WHERE ($1::uuid IS NULL OR de.campaign_id=$1)
       ), decisions AS (
         SELECT DISTINCT ON (job_id) job_id,campaign_id,event_type
         FROM relevant
         WHERE event_type IN ('accepted','rejected','unknown','reconciled_accepted',
           'reconciled_rejected','explicit_retry','retry_scheduled')
         ORDER BY job_id,recorded_at DESC,id DESC
        ), campaigns AS (
         SELECT DISTINCT campaign_id FROM relevant
        ), report AS (
       SELECT c.campaign_id "campaignId",
         (SELECT e.body->>'name' FROM campaigns.entities e WHERE e.kind='campaigns' AND e.id=c.campaign_id) "campaignName",
        (SELECT count(*) FROM decisions d WHERE d.campaign_id=c.campaign_id AND d.event_type IN ('accepted','reconciled_accepted'))::int accepted,
        (SELECT count(*) FROM decisions d WHERE d.campaign_id=c.campaign_id AND d.event_type IN ('rejected','reconciled_rejected'))::int rejected,
        (SELECT count(*) FROM decisions d WHERE d.campaign_id=c.campaign_id AND d.event_type='unknown')::int unknown,
        count(DISTINCT r.job_id) FILTER (WHERE r.event_type='provider_delivered')::int delivered,
        count(DISTINCT r.job_id) FILTER (WHERE r.event_type='provider_opened')::int opened,
        count(DISTINCT r.job_id) FILTER (WHERE r.event_type='provider_clicked')::int clicked,
        count(DISTINCT r.job_id) FILTER (WHERE r.event_type IN ('provider_bounced','provider_complained'))::int bounced,
        count(DISTINCT r.job_id) FILTER (WHERE r.event_type='provider_unsubscribed')::int unsubscribed
        FROM campaigns c JOIN relevant r ON r.campaign_id IS NOT DISTINCT FROM c.campaign_id
        GROUP BY c.campaign_id
        )
        SELECT report.*,
          count(*) OVER()::int "_total",
          sum(accepted) OVER()::int "_accepted", sum(delivered) OVER()::int "_delivered",
          sum(opened) OVER()::int "_opened", sum(clicked) OVER()::int "_clicked",
          sum(bounced) OVER()::int "_bounced", sum(unknown) OVER()::int "_unknown"
        FROM report
        ORDER BY (opened::numeric / NULLIF(delivered,0)) DESC NULLS LAST, "campaignId" ASC NULLS LAST
        LIMIT $2 OFFSET $3`, [campaignId, page.pageSize, page.offset]);
        const first = result.rows[0];
        const rows = result.rows.map(({ _total, _accepted, _delivered, _opened, _clicked, _bounced, _unknown, ...row }) => row);
        response.json({ data: rows, meta: {
                aggregation: "distinctJobsByImmutableEvents", page: page.page, pageSize: page.pageSize,
                total: Number(first?._total ?? 0), totals: {
                    accepted: Number(first?._accepted ?? 0), delivered: Number(first?._delivered ?? 0),
                    opened: Number(first?._opened ?? 0), clicked: Number(first?._clicked ?? 0),
                    bounced: Number(first?._bounced ?? 0), unknown: Number(first?._unknown ?? 0),
                },
            } });
    }));
    return router;
}
//# sourceMappingURL=delivery-reliability.js.map