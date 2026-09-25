import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { renderMergeVariables } from "./audience.js";
export function partitionAudience(id, recipients, percent) {
    const sorted = [...recipients].sort((a, b) => {
        const digest = (v) => createHash("sha256").update(`${id}:${v.id}`).digest("hex");
        return digest(a).localeCompare(digest(b));
    });
    const size = Math.floor(sorted.length * percent / 200);
    return sorted.map((subscriber, i) => ({ subscriber, arm: i < size ? "A" : i < size * 2 ? "B" : "remainder" }));
}
export function experimentDecision(results, minimum, ready) {
    if (!ready)
        return { winner: null, reason: "waiting" };
    if (results.A.accepted < minimum || results.B.accepted < minimum)
        return { winner: null, reason: "insufficient_sample" };
    if (!results.A.events && !results.B.events)
        return { winner: null, reason: "no_data" };
    if (results.A.events * results.B.accepted === results.B.events * results.A.accepted)
        return { winner: null, reason: "tie" };
    return { winner: results.A.rate > results.B.rate ? "A" : "B", reason: "winner" };
}
export function createExperimentsRouter(d) {
    const router = Router();
    const uuid = (value) => {
        if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
            throw d.http(400, "Invalid resource ID");
        return value;
    };
    const entity = async (db, kind, id) => {
        const r = await db.query("SELECT body FROM campaigns.entities WHERE kind=$1 AND id=$2", [kind, id]);
        if (!r.rows[0])
            throw d.http(404, "Not found");
        return r.rows[0].body;
    };
    const transact = async (fn) => {
        if (typeof d.db.connect !== "function")
            throw d.http(503, "Experiments require transactional PostgreSQL");
        const c = await d.db.connect();
        try {
            await c.query("BEGIN");
            await c.query("SELECT pg_advisory_xact_lock($1)", [731946215]);
            const result = await fn(c);
            await c.query("COMMIT");
            return result;
        }
        catch (e) {
            await c.query("ROLLBACK");
            throw e;
        }
        finally {
            c.release();
        }
    };
    const audit = async (db, req, action, id, metadata) => {
        await db.query("INSERT INTO campaigns.audit(id,action,entity_type,entity_id,actor_id,metadata) VALUES($1,$2,'experiments',$3,$4,$5)", [randomUUID(), `experiment.${action}`, id, req.user.id, metadata]);
    };
    const get = async (db, req, lock = false) => {
        const r = await db.query(`SELECT * FROM campaigns.experiments WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [uuid(req.params.id)]);
        if (!r.rows[0])
            throw d.http(404, "Experiment not found");
        d.allowed(req, r.rows[0].frozen.campaign);
        return r.rows[0];
    };
    router.get("/experiments", d.need("read"), d.wrap(async (req, res) => {
        const page = Math.max(1, Number(req.query.page ?? 1) || 1), pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize ?? 25) || 25));
        const allowed = d.lists(req), search = String(req.query.search ?? "").trim().toLowerCase();
        if (search.length > 200)
            throw d.http(400, "Search must not exceed 200 characters");
        const where = "($1::jsonb IS NULL OR frozen->'campaign'->'listIds' <@ $1::jsonb) AND ($2::text IS NULL OR lower(COALESCE(body->'variants'->'A'->>'subject','')) LIKE $2)";
        const args = [allowed === null ? null : JSON.stringify(allowed), search ? `%${search}%` : null, pageSize, (page - 1) * pageSize];
        const rows = await d.db.query(`SELECT body,frozen FROM campaigns.experiments WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, args);
        const count = await d.db.query(`SELECT count(*)::text count FROM campaigns.experiments WHERE ${where}`, args.slice(0, 2));
        res.json({ data: rows.rows.map(r => r.body), meta: { page, pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.get("/experiments/:id", d.need("read"), d.wrap(async (req, res) => res.json({ data: (await get(d.db, req)).body })));
    router.post("/experiments", d.mutation, d.need("campaigns:manage"), d.wrap(async (req, res) => {
        const b = req.body ?? {};
        if (Object.keys(b).some(k => !["campaignId", "variantB", "samplePercent", "minimumSample", "waitHours", "metric"].includes(k)) ||
            !Number.isInteger(b.samplePercent) || b.samplePercent < 1 || b.samplePercent > 100 ||
            !Number.isInteger(b.minimumSample) || b.minimumSample < 1 ||
            !Number.isInteger(b.waitHours) || b.waitHours < 1 || b.waitHours > 720 ||
            !["delivered", "opened", "clicked"].includes(b.metric) ||
            !b.variantB || typeof b.variantB.subject !== "string" || !b.variantB.subject.trim() || b.variantB.subject.length > 998)
            throw d.http(400, "Invalid experiment configuration");
        uuid(b.campaignId);
        uuid(b.variantB.templateId);
        if (Object.keys(b.variantB).some(k => !["subject", "templateId"].includes(k)))
            throw d.http(400, "Unknown variant field");
        const result = await transact(async (db) => {
            await db.query("SELECT id FROM campaigns.entities WHERE kind='campaigns' AND id=$1 FOR UPDATE", [b.campaignId]);
            const campaign = await entity(db, "campaigns", b.campaignId);
            d.allowed(req, campaign);
            if (campaign.status !== "draft" || (await db.query("SELECT 1 FROM campaigns.jobs WHERE campaign_id=$1 UNION ALL SELECT 1 FROM campaigns.experiments WHERE campaign_id=$1", [b.campaignId])).rowCount)
                throw d.http(409, "Experiment requires an unused draft campaign");
            const a = await entity(db, "templates", String(campaign.templateId)), bt = await entity(db, "templates", b.variantB.templateId);
            const audience = await d.resolveAudience(db, await d.scope(db), campaign, d.lists(req), d.now().toISOString());
            const id = randomUUID(), assigned = partitionAudience(id, audience.recipients, b.samplePercent);
            const n = assigned.filter(x => x.arm === "A").length;
            if (n < b.minimumSample)
                throw d.http(400, "Audience is too small for minimum per-variant sample");
            const body = { id, campaignId: b.campaignId, status: "draft", metric: b.metric, samplePercent: b.samplePercent, minimumSample: b.minimumSample, waitHours: b.waitHours,
                createdAt: d.now().toISOString(), startedAt: null, evaluatedAt: null, remainderApprovedAt: null,
                variants: { A: { subject: campaign.subject, templateId: campaign.templateId }, B: { subject: b.variantB.subject, templateId: b.variantB.templateId } },
                audience: { A: n, B: n, remainder: assigned.length - n * 2, total: assigned.length },
                results: { A: { accepted: 0, events: 0, rate: null }, B: { accepted: 0, events: 0, rate: null } }, winner: null, reason: "not_started" };
            await db.query("INSERT INTO campaigns.experiments(id,campaign_id,body,frozen) VALUES($1,$2,$3,$4)", [id, b.campaignId, body, { campaign, templates: { A: a, B: bt }, variants: body.variants }]);
            for (const { subscriber, arm } of assigned) {
                const variables = { ...(subscriber.metadata ?? {}), email: subscriber.email, firstName: subscriber.firstName ?? "", lastName: subscriber.lastName ?? "", name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" ") };
                const snapshots = {};
                for (const variant of ["A", "B"]) {
                    const t = variant === "A" ? a : bt, v = body.variants[variant], missing = String(campaign.mergeMissingPolicy ?? "empty");
                    snapshots[variant] = { campaign: { ...campaign, ...v, subject: renderMergeVariables(String(v.subject), variables, { format: "text", missing }) },
                        template: { ...t, html: renderMergeVariables(String(t.html ?? ""), variables, { format: "html", missing }), text: renderMergeVariables(String(t.text ?? ""), variables, { format: "text", missing }) },
                        subscriber, audience: { scope: audience.scope, generatedAt: audience.generatedAt, source: audience.source }, experimentId: id, experimentArm: arm, experimentVariant: variant };
                }
                await db.query("INSERT INTO campaigns.experiment_audience(experiment_id,recipient_id,arm,snapshot) VALUES($1,$2,$3,$4)", [id, subscriber.id, arm, snapshots]);
            }
            await audit(db, req, "create", id, body);
            return body;
        });
        res.status(201).json({ data: result });
    }));
    for (const action of ["start", "evaluate", "approve-remainder"])
        router.post(`/experiments/:id/${action}`, d.mutation, d.need("campaigns:send"), d.wrap(async (req, res) => {
            const input = req.body;
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                (action === "approve-remainder"
                    ? Object.keys(input).length !== 1 || input.approved !== true
                    : Object.keys(input).length !== 0))
                throw d.http(400, action === "approve-remainder" ? "Body must contain only approved:true" : "Body must be an empty object");
            if (action !== "evaluate")
                await d.activation();
            const result = await transact(async (db) => {
                const e = await get(db, req, true), b = e.body;
                const save = async () => { await db.query("UPDATE campaigns.experiments SET body=$2 WHERE id=$1", [e.id, b]); await audit(db, req, action, e.id, b); return b; };
                const queue = async (remainder) => {
                    const rows = await db.query("SELECT * FROM campaigns.experiment_audience WHERE experiment_id=$1 AND (arm='remainder')=$2", [e.id, remainder]);
                    for (const r of rows.rows)
                        await db.query("INSERT INTO campaigns.jobs(id,campaign_id,recipient_id,kind,state,run_at,snapshot) VALUES($1,$2,$3,'campaign','queued',now(),$4) ON CONFLICT(campaign_id,recipient_id,kind) DO NOTHING", [randomUUID(), e.campaign_id, r.recipient_id, r.snapshot[remainder ? b.winner : r.arm]]);
                    await db.query("UPDATE campaigns.entities SET body=jsonb_set(body,'{status}','\"sending\"'),updated_at=now() WHERE kind='campaigns' AND id=$1", [e.campaign_id]);
                };
                if (action === "start") {
                    if (b.status !== "draft")
                        return b;
                    b.status = "running";
                    b.startedAt = d.now().toISOString();
                    b.reason = "waiting";
                    await queue(false);
                    return save();
                }
                if (action === "approve-remainder") {
                    if (req.body?.approved !== true)
                        throw d.http(400, "Explicit approved:true is required");
                    if (b.status === "remainder_queued")
                        return b;
                    if (!b.winner)
                        throw d.http(409, "A recorded winner is required");
                    b.status = "remainder_queued";
                    b.remainderApprovedAt = d.now().toISOString();
                    await save();
                    await queue(true);
                    return b;
                }
                if (b.status === "draft")
                    throw d.http(409, "Experiment has not started");
                if (b.winner)
                    return b;
                const stats = await db.query(`SELECT a.arm,
       count(DISTINCT j.id) FILTER(WHERE EXISTS(SELECT 1 FROM campaigns.delivery_events v WHERE v.job_id=j.id AND v.event_type IN ('accepted','reconciled_accepted')))::text accepted,
       count(DISTINCT j.id) FILTER(WHERE EXISTS(SELECT 1 FROM campaigns.delivery_events v WHERE v.job_id=j.id AND v.event_type IN ('accepted','reconciled_accepted')) AND EXISTS(SELECT 1 FROM campaigns.delivery_events v WHERE v.job_id=j.id AND v.event_type=$2))::text events,
       max((SELECT max(recorded_at) FROM campaigns.delivery_events v WHERE v.job_id=j.id AND v.event_type IN ('accepted','reconciled_accepted'))) last_accepted,
       count(*) FILTER(WHERE j.id IS NULL OR j.state IN ('queued','sending','unknown'))::text pending
       FROM campaigns.experiment_audience a LEFT JOIN campaigns.jobs j ON j.campaign_id=$3 AND j.recipient_id=a.recipient_id AND j.kind='campaign'
       WHERE a.experiment_id=$1 AND a.arm IN ('A','B') GROUP BY a.arm`, [e.id, `provider_${b.metric}`, e.campaign_id]);
                let ready = true;
                for (const r of stats.rows) {
                    const accepted = Number(r.accepted), events = Number(r.events);
                    b.results[r.arm] = { accepted, events, rate: accepted ? events / accepted : null };
                    if (Number(r.pending) > 0 || d.now().getTime() < new Date(r.last_accepted ?? b.startedAt).getTime() + b.waitHours * 3600000)
                        ready = false;
                }
                Object.assign(b, experimentDecision(b.results, b.minimumSample, ready));
                b.evaluatedAt = d.now().toISOString();
                if (b.winner)
                    b.status = "winner_recorded";
                return save();
            });
            res.status(action === "evaluate" ? 200 : 202).json({ data: result });
        }));
    return router;
}
//# sourceMappingURL=experiments.js.map