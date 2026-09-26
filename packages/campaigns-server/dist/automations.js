import { randomUUID } from "node:crypto";
import { Router } from "express";
import { compileAudiencePredicate, createPostgresAudienceRepository, renderMergeVariables } from "./audience.js";
const LOCK = 731946215;
const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_CATCHUP_MS = 72 * 60 * 60 * 1000;
function validCalendarDate(value) {
    const match = DATE.exec(value);
    if (!match)
        return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}
function validTimezone(value) {
    if (typeof value !== "string" || value.length > 100)
        return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
        return true;
    }
    catch {
        return false;
    }
}
function zonedParts(date, timezone) {
    const values = {};
    for (const part of new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date)) {
        if (part.type !== "literal")
            values[part.type] = Number(part.value);
    }
    return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}
/**
 * Resolves a local calendar minute in an IANA zone. Ambiguous fall-back minutes
 * select the earlier instant; nonexistent spring-forward minutes return null.
 */
export function automationCalendarInstant(calendar, timezone) {
    if (!validTimezone(timezone))
        return null;
    const naive = Date.UTC(calendar.year, calendar.month - 1, calendar.day, calendar.hour, calendar.minute);
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 6) {
        const sample = new Date(naive + hours * 3_600_000);
        const parts = zonedParts(sample, timezone);
        offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample.getTime());
    }
    const matches = [];
    for (const offset of offsets) {
        const candidate = new Date(naive - offset);
        const parts = zonedParts(candidate, timezone);
        if (Object.keys(calendar).every(key => parts[key] === calendar[key]))
            matches.push(candidate);
    }
    matches.sort((a, b) => a.getTime() - b.getTime());
    return matches[0] ?? null;
}
export function automationAnnualDate(sourceDate, year, feb29Policy) {
    const match = DATE.exec(sourceDate.slice(0, 10));
    if (!match || !validCalendarDate(sourceDate.slice(0, 10)))
        return null;
    let month = Number(match[2]), day = Number(match[3]);
    if (month === 2 && day === 29 && !validCalendarDate(`${year}-02-29`)) {
        if (feb29Policy === "skip")
            return null;
        day = 28;
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function triggerCalendar(trigger, date) {
    const dateMatch = DATE.exec(date);
    const timeMatch = TIME.exec(trigger.time);
    return {
        year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]), minute: Number(timeMatch[2]),
    };
}
const pagination = (req) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize ?? 25) || 25));
    return { page, pageSize, offset: (page - 1) * pageSize };
};
export async function automationTransaction(db, work) {
    const tx = await db.connect();
    try {
        await tx.query("BEGIN");
        await tx.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
        const result = await work(tx);
        await tx.query("COMMIT");
        return result;
    }
    catch (error) {
        await tx.query("ROLLBACK");
        throw error;
    }
    finally {
        tx.release();
    }
}
function publicDefinition(row) {
    return { ...row.body, steps: row.body.steps.map((s) => {
            const { snapshot, predicate, ...step } = s;
            return step;
        }), id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function publicRun(row) {
    return { id: row.id, automationId: row.automation_id, eventId: row.event_id, subscriberId: row.subscriber_id,
        state: row.state, step: row.step, dueAt: row.due_at, jobId: row.job_id, error: row.error,
        createdAt: row.created_at, updatedAt: row.updated_at };
}
export function createAutomationsRouter(options) {
    const { db, mutation, need, wrap, assertListsAllowed, restrictedLists } = options;
    const router = Router();
    const get = async (tx, req, includeArchived = false) => {
        if (!uuid(req.params.id))
            throw fail(400, "Invalid automation ID");
        const row = (await tx.query("SELECT * FROM campaigns.automations WHERE id=$1", [req.params.id])).rows[0];
        if (!row || (!includeArchived && row.archived_at))
            throw fail(404, "Automation not found");
        assertListsAllowed(req, row.body.listIds);
        return row;
    };
    const validate = async (tx, req, raw) => {
        if (!object(raw) || Object.keys(raw).some(k => !["name", "trigger", "steps", "listIds"].includes(k)))
            throw fail(400, "Invalid automation fields");
        if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 120)
            throw fail(400, "Automation name required (max 120)");
        if (!Array.isArray(raw.listIds) || !raw.listIds.length || raw.listIds.length > 100 || raw.listIds.some(v => !uuid(v)) || new Set(raw.listIds).size !== raw.listIds.length)
            throw fail(400, "Unique listIds required");
        assertListsAllowed(req, raw.listIds);
        if ((await tx.query("SELECT id FROM campaigns.entities WHERE kind='lists' AND id=ANY($1::uuid[])", [raw.listIds])).rowCount !== raw.listIds.length)
            throw fail(400, "Unknown list");
        if (!object(raw.trigger) || typeof raw.trigger.type !== "string" || !/^[a-z][a-z0-9_.-]{0,99}$/.test(raw.trigger.type))
            throw fail(400, "Invalid trigger");
        const dateType = raw.trigger.type === "date.once" || raw.trigger.type === "date.annual";
        const triggerKeys = dateType
            ? raw.trigger.type === "date.once" ? ["type", "date", "time", "timezone"] : ["type", "customDateField", "time", "timezone", "feb29Policy"]
            : ["type", "tag", "listId"];
        if (Object.keys(raw.trigger).some(k => !triggerKeys.includes(k)))
            throw fail(400, "Invalid trigger");
        if (raw.trigger.tag !== undefined && (raw.trigger.type !== "tag.added" || typeof raw.trigger.tag !== "string" || !raw.trigger.tag || raw.trigger.tag.length > 100))
            throw fail(400, "Invalid trigger tag");
        if (raw.trigger.listId !== undefined && (raw.trigger.type !== "list.joined" || !raw.listIds.includes(raw.trigger.listId)))
            throw fail(400, "Trigger list must be within listIds");
        if (dateType) {
            if (!TIME.test(String(raw.trigger.time)) || !validTimezone(raw.trigger.timezone))
                throw fail(400, "Date trigger requires a valid time and IANA timezone");
            if (raw.trigger.type === "date.once") {
                if (typeof raw.trigger.date !== "string" || !validCalendarDate(raw.trigger.date))
                    throw fail(400, "One-off trigger requires a valid calendar date");
            }
            else {
                if (typeof raw.trigger.customDateField !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(raw.trigger.customDateField) || !["skip", "feb28"].includes(raw.trigger.feb29Policy))
                    throw fail(400, "Annual trigger requires a date field and Feb 29 policy");
                const definition = (await tx.query("SELECT definition FROM campaigns.audience_custom_fields WHERE scope=(SELECT scope::text FROM campaigns.installation) AND key=$1", [raw.trigger.customDateField])).rows[0]?.definition;
                if (definition?.type !== "date")
                    throw fail(400, "Annual trigger custom field must be an existing date field");
            }
        }
        if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 50)
            throw fail(400, "Provide 1–50 steps");
        const steps = [];
        const scope = (await tx.query("SELECT scope::text FROM campaigns.installation")).rows[0]?.scope;
        for (const step of raw.steps) {
            if (!object(step))
                throw fail(400, "Invalid step");
            if (step.type === "delay") {
                if (Object.keys(step).some(k => !["type", "seconds"].includes(k)) || !Number.isInteger(step.seconds) || step.seconds < 1 || step.seconds > 31536000)
                    throw fail(400, "Delay must be 1–31536000 seconds");
                steps.push({ type: "delay", seconds: step.seconds });
            }
            else if (step.type === "email") {
                if (Object.keys(step).some(k => !["type", "campaignId"].includes(k)) || !uuid(step.campaignId))
                    throw fail(400, "Invalid email step");
                const campaign = (await tx.query("SELECT body FROM campaigns.entities WHERE kind='campaigns' AND id=$1", [step.campaignId])).rows[0]?.body;
                if (!campaign)
                    throw fail(400, "Unknown campaign");
                assertListsAllowed(req, campaign.listIds);
                if (!campaign.listIds?.length || campaign.listIds.some((id) => !raw.listIds.includes(id)))
                    throw fail(400, "Email campaign lists must be within automation listIds");
                const template = (await tx.query("SELECT body FROM campaigns.entities WHERE kind='templates' AND id=$1", [campaign.templateId])).rows[0]?.body;
                if (!template || !(await tx.query("SELECT 1 FROM campaigns.entities WHERE kind='providers' AND id=$1", [campaign.providerId])).rowCount)
                    throw fail(400, "Missing template or provider");
                steps.push({ type: "email", campaignId: step.campaignId, snapshot: { campaign, template } });
            }
            else if (step.type === "condition") {
                if (Object.keys(step).some(k => !["type", "segmentId"].includes(k)) || !uuid(step.segmentId))
                    throw fail(400, "Invalid condition step");
                const segment = (await tx.query("SELECT predicate FROM campaigns.audience_segments WHERE scope=$1 AND id=$2", [scope, step.segmentId])).rows[0];
                if (!segment)
                    throw fail(400, "Unknown segment");
                const defs = (await tx.query("SELECT definition FROM campaigns.audience_custom_fields WHERE scope=$1", [scope])).rows.map(r => r.definition);
                compileAudiencePredicate(segment.predicate, defs);
                const inspect = (node) => {
                    if (node.field === "list" && node.value !== undefined) {
                        const ids = Array.isArray(node.value) ? node.value : [node.value];
                        assertListsAllowed(req, ids);
                        if (ids.some((id) => !raw.listIds.includes(id)))
                            throw fail(400, "Condition lists must be within automation listIds");
                    }
                    for (const child of node.and ?? node.or ?? [])
                        inspect(child);
                    if (node.not)
                        inspect(node.not);
                };
                inspect(segment.predicate);
                steps.push({ type: "condition", segmentId: step.segmentId, predicate: segment.predicate });
            }
            else
                throw fail(400, "Unknown step type");
        }
        return { name: raw.name.trim(), listIds: raw.listIds, trigger: raw.trigger, steps };
    };
    router.get("/automations", need("read"), wrap(async (req, res) => {
        const allowed = restrictedLists(req);
        const p = pagination(req), search = String(req.query.search ?? "").trim().toLowerCase();
        if (search.length > 200)
            throw fail(400, "Search must not exceed 200 characters");
        const args = [allowed === null ? null : JSON.stringify(allowed), search ? `%${search}%` : null, p.pageSize, p.offset];
        const where = "archived_at IS NULL AND ($1::jsonb IS NULL OR body->'listIds' <@ $1::jsonb) AND ($2::text IS NULL OR lower(body->>'name') LIKE $2)";
        const rows = await db.query(`SELECT * FROM campaigns.automations WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, args);
        const count = await db.query(`SELECT count(*)::text count FROM campaigns.automations WHERE ${where}`, args.slice(0, 2));
        res.json({ data: rows.rows.map(publicDefinition), meta: { page: p.page, pageSize: p.pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.post("/automations", mutation, need("campaigns:manage"), wrap(async (req, res) => {
        const result = await automationTransaction(db, async (tx) => {
            const body = await validate(tx, req, req.body);
            return (await tx.query("INSERT INTO campaigns.automations(body) VALUES($1) RETURNING *", [body])).rows[0];
        });
        res.status(201).json({ data: publicDefinition(result) });
    }));
    router.get("/automations/:id", need("read"), wrap(async (req, res) => { res.json({ data: publicDefinition(await get(db, req)) }); }));
    router.patch("/automations/:id", mutation, need("campaigns:manage"), wrap(async (req, res) => {
        const result = await automationTransaction(db, async (tx) => {
            const row = await get(tx, req);
            if (!["draft", "paused"].includes(row.status))
                throw fail(409, "Pause automation before editing");
            if (!object(req.body) || !Object.keys(req.body).length)
                throw fail(400, "Patch must not be empty");
            const old = publicDefinition(row);
            const body = await validate(tx, req, { name: old.name, listIds: old.listIds, trigger: old.trigger, steps: old.steps, ...req.body });
            return (await tx.query("UPDATE campaigns.automations SET body=$2,updated_at=now() WHERE id=$1 RETURNING *", [row.id, body])).rows[0];
        });
        res.json({ data: publicDefinition(result) });
    }));
    for (const action of ["activate", "pause", "cancel"])
        router.post(`/automations/:id/${action}`, mutation, need("campaigns:send"), wrap(async (req, res) => {
            const result = await automationTransaction(db, async (tx) => {
                const row = await get(tx, req);
                if (row.status === "cancelled" && action !== "cancel")
                    throw fail(409, "Cancelled automation is terminal");
                if (restrictedLists(req) !== null) {
                    const existing = await tx.query("SELECT definition FROM campaigns.automation_runs WHERE automation_id=$1 AND state IN ('running','unknown')", [row.id]);
                    for (const run of existing.rows)
                        assertListsAllowed(req, run.definition.listIds);
                }
                if (action === "activate") {
                    const old = publicDefinition(row);
                    row.body = await validate(tx, req, { name: old.name, listIds: old.listIds, trigger: old.trigger, steps: old.steps });
                    if (["date.once", "date.annual"].includes(row.body.trigger.type)) {
                        await tx.query(`INSERT INTO campaigns.automation_date_schedules(automation_id,trigger,last_scanned_at)
            VALUES($1,$2,now()) ON CONFLICT(automation_id) DO UPDATE SET
            last_scanned_at=CASE WHEN campaigns.automation_date_schedules.trigger IS DISTINCT FROM EXCLUDED.trigger THEN now() ELSE campaigns.automation_date_schedules.last_scanned_at END,
            trigger=EXCLUDED.trigger,updated_at=now()`, [row.id, row.body.trigger]);
                    }
                }
                if (action === "cancel") {
                    await tx.query("UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now() WHERE state='queued' AND automation_run_id IN (SELECT id FROM campaigns.automation_runs WHERE automation_id=$1)", [row.id]);
                    await tx.query("UPDATE campaigns.automation_runs SET state='cancelled',updated_at=now() WHERE automation_id=$1 AND state='running'", [row.id]);
                }
                return (await tx.query("UPDATE campaigns.automations SET status=$2,body=$3,updated_at=now() WHERE id=$1 RETURNING *", [row.id, action === "activate" ? "active" : action === "pause" ? "paused" : "cancelled", row.body])).rows[0];
            });
            res.json({ data: publicDefinition(result) });
        }));
    router.delete("/automations/:id", mutation, need("campaigns:manage"), wrap(async (req, res) => {
        const archived = await automationTransaction(db, async (tx) => {
            const row = await get(tx, req, true);
            if (row.archived_at)
                return false;
            await tx.query("UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now() WHERE state='queued' AND automation_run_id IN (SELECT id FROM campaigns.automation_runs WHERE automation_id=$1)", [row.id]);
            await tx.query("UPDATE campaigns.automation_runs SET state='cancelled',updated_at=now() WHERE automation_id=$1 AND state='running'", [row.id]);
            await tx.query("UPDATE campaigns.automations SET status='cancelled',archived_at=now(),updated_at=now() WHERE id=$1", [row.id]);
            const actor = req.user ? { id: req.user.id, name: req.user.name, email: req.user.email, roleIds: req.user.roleIds } : null;
            await tx.query("INSERT INTO campaigns.audit(id,action,entity_type,entity_id,actor_id,actor,ip_address,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), "automation.archived", "automation", row.id, req.user?.id ?? null, actor, req.ip ?? null, { outcome: "completed" }]);
            return true;
        });
        res.json({ data: { ok: true, archived } });
    }));
    router.post("/automation-events", mutation, need("campaigns:send"), wrap(async (req, res) => {
        const input = req.body;
        if (!object(input) || Object.keys(input).some(k => !["key", "type", "subscriberId", "payload"].includes(k)) || typeof input.key !== "string" || !input.key || input.key.length > 200 || input.key.startsWith("native:") || typeof input.type !== "string" || !/^[a-z][a-z0-9_.-]{0,99}$/.test(input.type) || !uuid(input.subscriberId) || (input.payload !== undefined && !object(input.payload)) || JSON.stringify(input.payload ?? {}).length > 16384)
            throw fail(400, "Invalid automation event");
        const result = await automationTransaction(db, async (tx) => {
            const sub = (await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1", [input.subscriberId])).rows[0]?.body;
            if (!sub)
                throw fail(404, "Subscriber not found");
            assertListsAllowed(req, sub.listIds);
            const inserted = await tx.query("INSERT INTO campaigns.automation_events(key,type,subscriber_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING RETURNING id", [input.key, input.type, input.subscriberId, input.payload ?? {}]);
            const row = (await tx.query("SELECT id, (type=$2 AND subscriber_id=$3 AND payload=$4::jsonb) AS matches FROM campaigns.automation_events WHERE key=$1", [input.key, input.type, input.subscriberId, input.payload ?? {}])).rows[0];
            if (!row.matches)
                throw fail(409, "Event key already used with different content");
            return { id: row.id, duplicate: !inserted.rowCount };
        });
        res.status(result.duplicate ? 200 : 201).json({ data: result });
    }));
    router.get("/automations/:id/runs", need("read"), wrap(async (req, res) => {
        await get(db, req, true);
        const allowed = restrictedLists(req);
        const p = pagination(req);
        const args = [req.params.id, allowed === null ? null : JSON.stringify(allowed), p.pageSize, p.offset];
        const where = "automation_id=$1 AND ($2::jsonb IS NULL OR (definition->'listIds' <@ $2::jsonb AND EXISTS(SELECT 1 FROM campaigns.entities s WHERE s.kind='subscribers' AND s.id=r.subscriber_id AND s.body->'listIds' <@ $2::jsonb)))";
        const rows = await db.query(`SELECT r.* FROM campaigns.automation_runs r WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, args);
        const count = await db.query(`SELECT count(*)::text count FROM campaigns.automation_runs r WHERE ${where}`, args.slice(0, 2));
        res.json({ data: rows.rows.map(publicRun), meta: { page: p.page, pageSize: p.pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.post("/automations/:id/runs/:runId/cancel", mutation, need("campaigns:send"), wrap(async (req, res) => {
        const result = await automationTransaction(db, async (tx) => {
            await get(tx, req);
            if (!uuid(req.params.runId))
                throw fail(400, "Invalid run ID");
            const row = (await tx.query("SELECT * FROM campaigns.automation_runs WHERE id=$1 AND automation_id=$2", [req.params.runId, req.params.id])).rows[0];
            if (!row)
                throw fail(404, "Run not found");
            assertListsAllowed(req, row.definition.listIds);
            const sub = (await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1", [row.subscriber_id])).rows[0];
            if (restrictedLists(req) !== null)
                assertListsAllowed(req, sub?.body.listIds);
            if (!["running", "cancelled"].includes(row.state))
                throw fail(409, "Run is terminal; unknown delivery requires reconciliation");
            await tx.query("UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now() WHERE automation_run_id=$1 AND state='queued'", [row.id]);
            return (await tx.query("UPDATE campaigns.automation_runs SET state='cancelled',updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
        });
        res.json({ data: publicRun(result) });
    }));
    return router;
}
/**
 * Materializes due calendar occurrences as ordinary automation events. The
 * caller may supply `now` for a deterministic tick. Each tick is transactional;
 * event and occurrence uniqueness make retries harmless.
 */
export async function scheduleDateAutomations(db, now = new Date(), limit = 100) {
    const tx = await db.connect();
    let created = 0;
    try {
        await tx.query("BEGIN");
        const automations = await tx.query(`SELECT a.id,a.body,s.last_scanned_at,s.trigger schedule_trigger
      FROM campaigns.automations a
      LEFT JOIN campaigns.automation_date_schedules s ON s.automation_id=a.id
      WHERE a.status='active' AND a.body->'trigger'->>'type' IN ('date.once','date.annual')
      ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT $1`, [limit]);
        for (const automation of automations.rows) {
            const trigger = automation.body.trigger;
            if (!automation.last_scanned_at) {
                await tx.query("INSERT INTO campaigns.automation_date_schedules(automation_id,trigger,last_scanned_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [automation.id, trigger, now]);
                continue;
            }
            if (JSON.stringify(automation.schedule_trigger) !== JSON.stringify(trigger)) {
                await tx.query("UPDATE campaigns.automation_date_schedules SET trigger=$2,last_scanned_at=$3,updated_at=now() WHERE automation_id=$1", [automation.id, trigger, now]);
                continue;
            }
            const cursor = new Date(automation.last_scanned_at);
            const start = new Date(Math.max(cursor.getTime(), now.getTime() - DATE_CATCHUP_MS));
            if (start >= now)
                continue;
            const subscribers = await tx.query(`SELECT id,body FROM campaigns.entities
        WHERE kind='subscribers' AND body->>'status'='subscribed'
          AND jsonb_array_length(body->'listIds')>0 AND body->'listIds' <@ $1::jsonb`, [JSON.stringify(automation.body.listIds)]);
            for (const subscriber of subscribers.rows) {
                const dates = [];
                if (trigger.type === "date.once") {
                    const instant = automationCalendarInstant(triggerCalendar(trigger, trigger.date), trigger.timezone);
                    if (instant)
                        dates.push({ key: trigger.date, instant });
                }
                else {
                    const source = subscriber.body.metadata?.[trigger.customDateField];
                    const sourceDate = typeof source === "string" ? source.slice(0, 10) : "";
                    const match = DATE.exec(sourceDate);
                    if (match && validCalendarDate(sourceDate)) {
                        const fromYear = zonedParts(start, trigger.timezone).year;
                        const toYear = zonedParts(now, trigger.timezone).year;
                        for (let year = fromYear; year <= toYear; year++) {
                            const occurrenceDate = automationAnnualDate(sourceDate, year, trigger.feb29Policy);
                            if (!occurrenceDate)
                                continue;
                            const instant = automationCalendarInstant(triggerCalendar(trigger, occurrenceDate), trigger.timezone);
                            if (instant)
                                dates.push({ key: occurrenceDate, instant });
                        }
                    }
                }
                for (const occurrence of dates) {
                    if (occurrence.instant <= start || occurrence.instant > now)
                        continue;
                    const exists = await tx.query("SELECT 1 FROM campaigns.automation_date_occurrences WHERE automation_id=$1 AND subscriber_id=$2 AND occurrence_key=$3", [automation.id, subscriber.id, occurrence.key]);
                    if (exists.rowCount)
                        continue;
                    const eventKey = `date:${automation.id}:${subscriber.id}:${occurrence.key}`;
                    const payload = { automationId: automation.id, occurrence: occurrence.key, scheduledAt: occurrence.instant.toISOString() };
                    const inserted = await tx.query("INSERT INTO campaigns.automation_events(key,type,subscriber_id,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO NOTHING RETURNING id", [eventKey, trigger.type, subscriber.id, payload, occurrence.instant]);
                    const eventId = inserted.rows[0]?.id ?? (await tx.query("SELECT id FROM campaigns.automation_events WHERE key=$1", [eventKey])).rows[0]?.id;
                    if (!eventId)
                        throw new Error("Date automation event could not be persisted");
                    const ledger = await tx.query("INSERT INTO campaigns.automation_date_occurrences(automation_id,subscriber_id,occurrence_key,event_id,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [automation.id, subscriber.id, occurrence.key, eventId, occurrence.instant]);
                    if (ledger.rowCount)
                        created++;
                }
            }
            await tx.query("UPDATE campaigns.automation_date_schedules SET last_scanned_at=$2,updated_at=now() WHERE automation_id=$1", [automation.id, now]);
        }
        await tx.query("COMMIT");
        return created;
    }
    catch (error) {
        await tx.query("ROLLBACK");
        throw error;
    }
    finally {
        tx.release();
    }
}
/** Caller holds the delivery/restore advisory lock for the entire worker tick. */
export async function advanceAutomations(db, limit = 100) {
    await scheduleDateAutomations(db, new Date(), limit);
    const tx = await db.connect();
    try {
        await tx.query("BEGIN");
        const rows = await tx.query("SELECT r.* FROM campaigns.automation_runs r JOIN campaigns.automations a ON a.id=r.automation_id WHERE r.state='running' AND a.status='active' AND r.due_at<=now() ORDER BY r.due_at FOR UPDATE OF r SKIP LOCKED LIMIT $1", [limit]);
        for (const run of rows.rows) {
            const sub = (await tx.query("SELECT body FROM campaigns.entities WHERE kind='subscribers' AND id=$1", [run.subscriber_id])).rows[0]?.body;
            let state = "running", error = null;
            let next = run.step, due = null, jobId = run.job_id;
            if (!sub || sub.status !== "subscribed" || !sub.listIds?.length || sub.listIds.some((id) => !run.definition.listIds.includes(id))) {
                state = "cancelled";
                error = "recipient_suppressed_or_outside_lists";
                await tx.query("UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now() WHERE automation_run_id=$1 AND state='queued'", [run.id]);
            }
            else {
                if (jobId) {
                    const job = (await tx.query("SELECT state FROM campaigns.jobs WHERE id=$1", [jobId])).rows[0];
                    if (job?.state === "sent") {
                        next++;
                        jobId = null;
                    }
                    else if (job?.state === "unknown") {
                        state = "unknown";
                        error = "Delivery outcome unknown; no automatic retry";
                    }
                    else if (job?.state === "rejected") {
                        state = "failed";
                        error = "Delivery rejected";
                    }
                    else if (job?.state === "cancelled")
                        state = "cancelled";
                }
                if (state === "running" && !jobId) {
                    const step = run.definition.steps[next];
                    if (!step)
                        state = "completed";
                    else if (step.type === "delay") {
                        next++;
                        due = new Date(Date.now() + step.seconds * 1000);
                    }
                    else if (step.type === "condition") {
                        const defs = (await tx.query("SELECT definition FROM campaigns.audience_custom_fields WHERE scope=$1", [sub.scope])).rows.map(r => r.definition);
                        try {
                            const compiled = compileAudiencePredicate(step.predicate, defs);
                            const sql = compiled.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 2}`);
                            const match = await tx.query(`SELECT 1 FROM campaigns.entities s WHERE s.kind='subscribers' AND s.id=$1 AND s.body->>'scope'=$2 AND (${sql})`, [run.subscriber_id, sub.scope, ...compiled.values]);
                            if (match.rowCount)
                                next++;
                            else
                                state = "skipped";
                        }
                        catch (e) {
                            state = "failed";
                            error = String(e.message).slice(0, 500);
                        }
                    }
                    else if (step.type === "email") {
                        try {
                            const snapshot = structuredClone(step.snapshot);
                            const excludeListIds = (snapshot.campaign.excludeListIds ?? []);
                            const excludeSegmentIds = (snapshot.campaign.excludeSegmentIds ?? []);
                            if (excludeListIds.length || excludeSegmentIds.length) {
                                const excluded = await createPostgresAudienceRepository(tx).recipients(String(sub.scope), { listIds: excludeListIds, segmentIds: excludeSegmentIds }, null);
                                if (excluded.some(recipient => recipient.id === run.subscriber_id)) {
                                    throw Object.assign(new Error("recipient_excluded"), { recipientExcluded: true });
                                }
                            }
                            const values = { ...sub, ...(sub.metadata ?? {}) };
                            const missing = snapshot.campaign.mergeMissingPolicy ?? "error";
                            snapshot.template.html = renderMergeVariables(String(snapshot.template.html ?? ""), values, { format: "html", missing });
                            snapshot.template.text = renderMergeVariables(String(snapshot.template.text ?? ""), values, { format: "text", missing });
                            snapshot.campaign.subject = renderMergeVariables(String(snapshot.campaign.subject ?? ""), values, { format: "text", missing });
                            snapshot.subscriber = sub;
                            snapshot.audience = { scope: sub.scope };
                            jobId = randomUUID();
                            await tx.query("INSERT INTO campaigns.jobs(id,campaign_id,recipient_id,kind,state,run_at,snapshot,automation_run_id,automation_step) VALUES($1,NULL,$2,'automation','queued',now(),$3,$4,$5)", [jobId, run.subscriber_id, snapshot, run.id, next]);
                        }
                        catch (e) {
                            // Validation happens before inserting; database failures must roll back the tick.
                            if (e.code)
                                throw e;
                            if (e.recipientExcluded) {
                                state = "skipped";
                                error = "recipient_excluded";
                            }
                            else {
                                state = "failed";
                                error = String(e.message).slice(0, 500);
                            }
                        }
                    }
                }
            }
            await tx.query("UPDATE campaigns.automation_runs SET state=$2,step=$3,due_at=coalesce($4,now()),job_id=$5,error=$6,updated_at=now() WHERE id=$1", [run.id, state, next, due, jobId, error]);
        }
        await tx.query("COMMIT");
    }
    catch (error) {
        await tx.query("ROLLBACK");
        throw error;
    }
    finally {
        tx.release();
    }
}
//# sourceMappingURL=automations.js.map