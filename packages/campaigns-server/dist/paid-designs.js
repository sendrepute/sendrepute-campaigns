import { createHash } from "node:crypto";
import { compilePaidDesign } from "./paid-design-compiler.js";
import { PaidRequestNotDispatchedError } from "@workspace/campaigns-bridge";
export const paidDesignOperations = new Set(["customerCreateAiEmailTemplate", "customerCreateVipEmailTemplate", "customerCreateVipEmailBuilderAccess"]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stable = (v) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
function implicitIdentity(scope, owner, operation, input) {
    const hex = createHash("sha256").update(stable([scope, owner, operation, input])).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function fail(message, status = 502) { throw Object.assign(new Error(message), { status, code: "PAID_DESIGN_RECOVERY_REQUIRED" }); }
export function paidDesignScope(secret) { return createHash("sha256").update("paid-design-v1\0").update(secret).digest("hex"); }
/** No age cutoff: these records are durable entitlements, not a billing retry queue. */
export class PaidDesigns {
    db;
    bridge;
    scope;
    owner;
    readPaid;
    compile;
    constructor(db, bridge, scope, owner, readPaid, compile = compilePaidDesign) {
        this.db = db;
        this.bridge = bridge;
        this.scope = scope;
        this.owner = owner;
        this.readPaid = readPaid;
        this.compile = compile;
    }
    execute(operation, input) { return this.bridge.execute(operation, input); }
    async purchase(operation, value) {
        const input = object(value), body = object(input.body);
        const catalog = operation === "customerCreateVipEmailBuilderAccess";
        // Legacy clients have no recovery token. Identical requests from them must
        // not become a second debit after a lost response. New clients may supply
        // a fresh recoveryId for an intentionally new generation.
        const id = String((catalog ? body.requestId : body.recoveryId) ?? implicitIdentity(this.scope, this.owner, operation, input));
        if (!uuid.test(id))
            fail("Paid design request identity must be a UUID", 400);
        const forwarded = { ...input, body: { ...body, [catalog ? "requestId" : "recoveryId"]: id } };
        let source = null;
        if (catalog) {
            if (body.sourceKind !== "template" || typeof body.templateId !== "string")
                fail("Durable VIP purchase requires a catalog template", 400);
            const template = object(await this.execute("customerGetVipBuilderTemplate", { path: { templateId: body.templateId } }));
            source = object(template.document);
            if (!Array.isArray(source.rows))
                fail("VIP catalog did not return a canonical native document");
        }
        const inserted = await this.db.query("INSERT INTO campaigns.paid_designs(id,scope,owner_id,operation,input,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING *", [id, this.scope, this.owner, operation, forwarded, source]);
        if (!inserted.rows[0]) {
            const old = (await this.db.query("SELECT * FROM campaigns.paid_designs WHERE id=$1 AND scope=$2 AND owner_id=$3", [id, this.scope, this.owner])).rows[0];
            if (!old || old.operation !== operation)
                fail("Paid design identity belongs to another request", 409);
            if (old.template_deleted_at)
                fail("This saved design was deleted. The payment record is retained; no purchase was repeated.", 410);
            // JSONB key ordering is not stable; compare normalized structure.
            if (stable(old.input) !== stable(forwarded))
                fail("Paid design identity payload mismatch", 409);
            await this.reconcile(old);
            const current = (await this.db.query("SELECT * FROM campaigns.paid_designs WHERE id=$1 AND scope=$2 AND owner_id=$3", [id, this.scope, this.owner])).rows[0];
            if (current.status === "succeeded")
                return { ...current.result, savedTemplateId: id };
            fail("Paid outcome is unresolved; consult /paid-designs. Do not repeat payment.", 409);
        }
        // The committed intent always precedes the only paid call.
        let result;
        try {
            result = object(await this.execute(operation, forwarded));
        }
        catch (error) {
            if (error instanceof PaidRequestNotDispatchedError) {
                await this.db.query("UPDATE campaigns.paid_designs SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND scope=$3 AND owner_id=$4 AND status='pending'", [id, `No paid request was sent: preflight rejected (${error.code}). No automatic retry was made.`, this.scope, this.owner]);
            }
            throw error;
        }
        await this.save(inserted.rows[0], result);
        return { ...result, savedTemplateId: id };
    }
    async save(intent, result) {
        const standard = intent.operation === "customerCreateAiEmailTemplate";
        const doc = object(result.document ?? intent.source);
        const accessId = result.nativeAccessId ?? result.accessId;
        if (doc.version !== 1 || (standard ? doc.kind !== "mjml" || typeof doc.mjml !== "string" || !/^\s*<mjml(?:\s|>)/i.test(doc.mjml) : !Array.isArray(doc.rows) || typeof accessId !== "string" || !accessId))
            fail("Paid result lacks canonical source or owned VIP access; recovery retained");
        const now = new Date().toISOString();
        const template = { id: intent.id, name: String(doc.title || "Paid design").slice(0, 160), subject: String(doc.subject || doc.title || "Paid design").slice(0, 255),
            html: "", text: "", createdAt: now, updatedAt: now,
            metadata: { paidDesignId: intent.id, paidDesignScope: intent.scope, paidDesignOwner: intent.owner_id, compilePending: true,
                ...(standard ? { editor: "hosted-standard", mjml: doc.mjml, standardDocument: doc } : { editor: "hosted-vip", hostedDocument: doc, vipAccessId: accessId }),
                sourceIdentity: { sourceKind: standard || intent.operation === "customerCreateVipEmailTemplate" ? "ai" : "template", designId: result.designId, accessId, ...(object(intent.input.body).templateId ? { templateId: object(intent.input.body).templateId } : {}) } } };
        // A single statement is atomic even on pools/mocks without connect().
        const saved = await this.db.query(`WITH saved AS (
      INSERT INTO campaigns.entities(kind,id,body) VALUES('templates',$1,$2)
      ON CONFLICT(kind,id) DO NOTHING RETURNING id
    ) UPDATE campaigns.paid_designs SET status='succeeded',result=$3,error=NULL,updated_at=now()
      WHERE id=$1 AND scope=$4 AND owner_id=$5 AND (
        EXISTS(SELECT 1 FROM saved) OR EXISTS(SELECT 1 FROM campaigns.entities
          WHERE kind='templates' AND id=$1 AND body->'metadata'->>'paidDesignId'=$1::text
          AND body->'metadata'->>'paidDesignScope'=$4 AND body->'metadata'->>'paidDesignOwner'=$5))
      RETURNING id`, [intent.id, template, result, this.scope, this.owner]);
        if (!saved.rowCount)
            fail("Saved template identity conflict; paid recovery retained");
        // Canonical source and successful intent are committed first. Compilation
        // happens outside that statement/any transaction, and can never re-charge.
        await this.repairPreviews(intent.id);
    }
    async repairPreviews(id) {
        const candidates = await this.db.query(`SELECT e.id,e.body FROM campaigns.entities e
      JOIN campaigns.paid_designs p ON p.id=e.id
      WHERE e.kind='templates' AND p.scope=$1 AND p.owner_id=$2 AND p.status='succeeded'
      AND e.body->'metadata'->>'compilePending'='true' AND COALESCE(e.body->>'html','')=''
      AND ($3::uuid IS NULL OR e.id=$3)
      ORDER BY e.updated_at,e.id LIMIT 5`, [this.scope, this.owner, id ?? null]);
        await Promise.all(candidates.rows.map(async (row) => {
            const metadata = { ...object(row.body.metadata) };
            let next, error = null;
            try {
                const html = await this.compile(metadata);
                delete metadata.compilePending;
                delete metadata.compileError;
                next = { ...row.body, html, metadata, updatedAt: new Date().toISOString() };
            }
            catch (failure) {
                const code = failure instanceof Error && /^[A-Z_]{1,64}$/.test(failure.message) ? failure.message : "COMPILER_UNAVAILABLE";
                error = `Free preview compilation failed (${code}); canonical source is saved. Reopen to retry without payment.`;
                next = { ...row.body, metadata: { ...metadata, compilePending: true, compileError: error } };
            }
            // Full snapshot CAS includes canonical source, rendered HTML and metadata:
            // never overwrite a later browser return, edit, or another compiler.
            await this.db.query(`WITH preview AS (
        UPDATE campaigns.entities SET body=$3,updated_at=now()
        WHERE kind='templates' AND id=$1 AND body=$2::jsonb RETURNING id
      ) UPDATE campaigns.paid_designs SET error=$4 WHERE id IN (SELECT id FROM preview)
        AND scope=$5 AND owner_id=$6 AND status='succeeded'`, [row.id, row.body, next, error, this.scope, this.owner]);
        }));
    }
    async reconcile(intent) {
        if (intent.status !== "pending" || intent.template_deleted_at)
            return;
        try {
            if (intent.operation === "customerCreateVipEmailBuilderAccess") {
                const result = object(await this.execute("customerGetVipEmailBuilderAccess", { path: { accessId: intent.id } }));
                if (result.accessId !== intent.id)
                    fail("VIP recovery returned mismatched ownership");
                await this.save(intent, result);
            }
            else {
                const read = this.bridge.getPaidResult?.bind(this.bridge) ?? this.readPaid;
                if (!read)
                    fail("Central paid-result recovery contract unavailable");
                const result = object(await read(intent.id));
                const expected = intent.operation === "customerCreateAiEmailTemplate" ? "customerStandardAiGenerate" : "customerVipAiGenerate";
                if (result.operation !== expected || !["pending", "succeeded", "failed"].includes(String(result.status)))
                    fail("Central paid-result recovery contract mismatch");
                if (result.status === "succeeded")
                    await this.save(intent, object(result.result));
                if (result.status === "failed")
                    await this.db.query("UPDATE campaigns.paid_designs SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND scope=$3 AND owner_id=$4", [intent.id, "Central generation failed; no automatic paid retry", this.scope, this.owner]);
            }
        }
        catch {
            await this.db.query("UPDATE campaigns.paid_designs SET error=$2,updated_at=now() WHERE id=$1 AND scope=$3 AND owner_id=$4 AND status='pending'", [intent.id, "Payment outcome is unconfirmed: no verifiable saved result is available from the read-only check. This does not prove no charge. Keep this reference for support; do not purchase again.", this.scope, this.owner]);
        }
    }
    async list(templateId) {
        const pending = await this.db.query("SELECT * FROM campaigns.paid_designs WHERE scope=$1 AND owner_id=$2 AND status='pending' AND ($3::uuid IS NULL OR id=$3) ORDER BY updated_at,id LIMIT 5", [this.scope, this.owner, templateId ?? null]);
        await Promise.all(pending.rows.map(row => this.reconcile(row)));
        await this.repairPreviews(templateId);
        const rows = await this.db.query("SELECT * FROM campaigns.paid_designs WHERE scope=$1 AND owner_id=$2 ORDER BY created_at DESC,id LIMIT 100", [this.scope, this.owner]);
        return { items: rows.rows.map(row => ({ id: row.id, status: row.template_deleted_at && row.status === "succeeded" ? "deleted" : row.status,
                templateId: row.status === "succeeded" && !row.template_deleted_at ? row.id : null, ...(row.error ? { error: row.error } : {}) })) };
    }
}
//# sourceMappingURL=paid-designs.js.map