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
        if (catalog && body.requestId !== undefined && body.recoveryId !== undefined && body.requestId !== body.recoveryId) {
            fail("Catalog requestId and recoveryId must identify the same purchase", 400);
        }
        const id = String((catalog ? body.recoveryId ?? body.requestId : body.recoveryId) ?? implicitIdentity(this.scope, this.owner, operation, input));
        if (!uuid.test(id))
            fail("Paid design request identity must be a UUID", 400);
        const forwarded = { ...input, body: { ...body, ...(catalog ? { requestId: id } : {}), recoveryId: id } };
        const identity = await this.bridge.getPaidIdentity?.();
        if (!identity?.accountId || !identity.credentialId)
            fail("Authenticated central account and credential identity unavailable; no paid request sent", 409);
        if (!this.bridge.getPaidResult || !this.bridge.resolvePaidResult)
            fail("Authenticated central settlement contract unavailable; no paid request sent", 409);
        let source = null;
        if (catalog) {
            if (body.sourceKind !== "template" || typeof body.templateId !== "string")
                fail("Durable VIP purchase requires a catalog template", 400);
            const template = object(await this.execute("customerGetVipBuilderTemplate", { path: { templateId: body.templateId } }));
            source = object(template.document);
            if (!Array.isArray(source.rows))
                fail("VIP catalog did not return a canonical native document");
        }
        const inserted = await this.db.query("INSERT INTO campaigns.paid_designs(id,scope,owner_id,operation,input,source,central_account_id,central_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *", [id, this.scope, this.owner, operation, forwarded, source, identity.accountId, identity.credentialId]);
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
                await this.db.query("UPDATE campaigns.paid_designs SET status='failed',recovery_reason='NOT_DISPATCHED',error=$2,updated_at=now() WHERE id=$1 AND scope=$3 AND owner_id=$4 AND status='pending'", [id, `No paid request was sent: preflight rejected (${error.code}). No automatic retry was made.`, this.scope, this.owner]);
            }
            throw error;
        }
        // A successful HTTP response alone is not settlement evidence.
        await this.reconcile(inserted.rows[0]);
        const settled = (await this.db.query("SELECT * FROM campaigns.paid_designs WHERE id=$1 AND scope=$2 AND owner_id=$3", [id, this.scope, this.owner])).rows[0];
        if (settled?.status !== "succeeded" || settled.template_deleted_at)
            fail("Payment outcome awaits authoritative settlement; do not purchase again", 409);
        return { ...settled.result, savedTemplateId: id };
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
      INSERT INTO campaigns.entities(kind,id,body)
      SELECT 'templates',$1,$2::jsonb FROM campaigns.paid_designs
      WHERE id=$1 AND scope=$4 AND owner_id=$5 AND template_deleted_at IS NULL AND status='pending'
      ON CONFLICT(kind,id) DO NOTHING RETURNING id
    ) UPDATE campaigns.paid_designs SET status='succeeded',result=$3,error=NULL,updated_at=now()
      WHERE id=$1 AND scope=$4 AND owner_id=$5 AND template_deleted_at IS NULL AND status='pending' AND (
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
    /** Explicit, owner-scoped local repair. Never dispatch a paid or central request. */
    async restoreSavedSource(id) {
        if (!uuid.test(id))
            fail("Invalid paid design reference", 400);
        const intent = (await this.db.query("SELECT * FROM campaigns.paid_designs WHERE id=$1 AND scope=$2 AND owner_id=$3", [id, this.scope, this.owner])).rows[0];
        if (!intent)
            fail("Paid design reference not found for this owner and connection", 404);
        if (intent.template_deleted_at)
            fail("This saved design was intentionally deleted; it cannot be restored", 410);
        if (intent.status !== "succeeded" || !intent.result)
            fail("Payment outcome is not verified locally. No paid request was made.", 409);
        const body = object(intent.input.body), result = object(intent.result);
        const standard = intent.operation === "customerCreateAiEmailTemplate";
        const catalog = intent.operation === "customerCreateVipEmailBuilderAccess";
        if ((catalog ? body.requestId : body.recoveryId) !== id ||
            !paidDesignOperations.has(intent.operation) ||
            (!standard && (typeof result.designId !== "string" || !result.designId))) {
            fail("Retained paid source identity could not be verified; no template was changed", 409);
        }
        const doc = catalog ? object(intent.source) : object(result.document);
        const accessId = catalog ? result.accessId : standard ? result.accessId : result.nativeAccessId;
        if (doc.version !== 1 || (standard
            ? doc.kind !== "mjml" || typeof doc.mjml !== "string" || !/^\s*<mjml(?:\s|>)/i.test(doc.mjml)
            : !Array.isArray(doc.rows) || typeof accessId !== "string" || !accessId) ||
            (catalog && (accessId !== id || result.designId !== body.designId || result.templateId !== body.templateId || result.sourceKind !== "template")) ||
            (!catalog && typeof accessId !== "string")) {
            fail("Retained paid source or owned access is invalid; no template was changed", 409);
        }
        const now = new Date().toISOString();
        const template = { id, name: String(doc.title || "Paid design").slice(0, 160), subject: String(doc.subject || doc.title || "Paid design").slice(0, 255),
            html: "", text: "", createdAt: now, updatedAt: now,
            metadata: { paidDesignId: id, paidDesignScope: this.scope, paidDesignOwner: this.owner, compilePending: true,
                ...(standard ? { editor: "hosted-standard", mjml: doc.mjml, standardDocument: doc } : { editor: "hosted-vip", hostedDocument: doc, vipAccessId: accessId }),
                sourceIdentity: { sourceKind: catalog ? "template" : "ai", designId: result.designId, accessId,
                    ...(body.templateId ? { templateId: body.templateId } : {}) } } };
        // A single INSERT ... SELECT guards owner, scope, success and tombstone at
        // commit. The deletion trigger locks the paid row against concurrent DELETE.
        const inserted = await this.db.query(`INSERT INTO campaigns.entities(kind,id,body)
      SELECT 'templates',$1,$2::jsonb FROM campaigns.paid_designs p
      WHERE p.id=$1 AND p.scope=$3 AND p.owner_id=$4 AND p.status='succeeded'
        AND p.template_deleted_at IS NULL AND p.result=$5::jsonb
        AND p.input=$6::jsonb AND p.source IS NOT DISTINCT FROM $7::jsonb
      ON CONFLICT(kind,id) DO NOTHING RETURNING id`, [id, template, this.scope, this.owner, result, intent.input, intent.source]);
        if (!inserted.rowCount) {
            const existing = await this.db.query("SELECT e.body FROM campaigns.entities e JOIN campaigns.paid_designs p ON p.id=e.id WHERE e.kind='templates' AND e.id=$1 AND p.scope=$2 AND p.owner_id=$3 AND p.template_deleted_at IS NULL", [id, this.scope, this.owner]);
            if (!existing.rows[0] || object(existing.rows[0].body.metadata).paidDesignId !== id ||
                object(existing.rows[0].body.metadata).paidDesignOwner !== this.owner ||
                object(existing.rows[0].body.metadata).paidDesignScope !== this.scope) {
                fail("Saved source could not be restored safely; no existing template was overwritten", 409);
            }
            return "already-present";
        }
        await this.repairPreviews(id);
        return "restored";
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
    async reconcile(intent, operator = false) {
        if (intent.status !== "pending" || intent.template_deleted_at)
            return;
        // The claim is atomic across processes, requests and browser reloads. A
        // read-only lookup can be slow, but no second caller may spend its budget.
        const claim = await this.db.query(`UPDATE campaigns.paid_designs
      SET recovery_checks=recovery_checks+1,last_recovery_check_at=now(),recovery_reason='CHECKING'
      WHERE id=$1 AND scope=$2 AND owner_id=$3 AND status='pending' AND template_deleted_at IS NULL
        AND (last_recovery_check_at IS NULL OR last_recovery_check_at <= now() - ($4::int * interval '1 second'))
        AND ($5::boolean OR recovery_checks<3)
      RETURNING *`, [intent.id, this.scope, this.owner, operator ? 86400 : 30, operator]);
        if (!claim.rowCount)
            return;
        let reason = "READ_UNAVAILABLE";
        try {
            await this.verifyIdentity(intent);
            const read = this.bridge.getPaidResult?.bind(this.bridge) ?? this.readPaid;
            if (!read)
                fail("Central paid-result recovery contract unavailable");
            const envelope = object(await read(intent.id));
            reason = "CONTRACT_MISMATCH";
            await this.consumeSettlement(intent, envelope);
        }
        catch {
            await this.db.query("UPDATE campaigns.paid_designs SET error=$2,recovery_reason=$5,updated_at=now() WHERE id=$1 AND scope=$3 AND owner_id=$4 AND status='pending'", [intent.id, "Payment outcome is unconfirmed: no verifiable saved result is available from the read-only check. This does not prove no charge. Keep this reference for support; do not purchase again.", this.scope, this.owner, reason]);
        }
    }
    async verifyIdentity(intent) {
        const identity = await this.bridge.getPaidIdentity?.();
        // Legacy rows have no trustworthy pre-dispatch identity. Never infer it
        // from a present-day credential or upgrade them from an unrelated receipt.
        if (!intent.central_account_id || !intent.central_credential_id ||
            identity?.accountId !== intent.central_account_id || identity?.credentialId !== intent.central_credential_id) {
            fail("Original authenticated payment identity unavailable; payment protection retained", 409);
        }
    }
    async consumeSettlement(intent, envelope) {
        const proof = object(envelope.settlement);
        const expected = intent.operation === "customerCreateAiEmailTemplate" ? "customerStandardAiGenerate"
            : intent.operation === "customerCreateVipEmailTemplate" ? "customerVipAiGenerate" : "customerVipBuilderAccess";
        if (envelope.operation !== expected || proof.recoveryId !== intent.id ||
            proof.accountId !== intent.central_account_id || proof.credentialId !== intent.central_credential_id ||
            typeof proof.receiptId !== "string" || !proof.receiptId)
            fail("Exact authenticated settlement evidence unavailable");
        if (proof.kind === "unresolved")
            fail("Central outcome remains unresolved; payment protection retained", 409);
        const amount = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
        if (!["paid_result", "no_charge", "confirmed_refund"].includes(String(proof.kind)) ||
            (proof.kind === "paid_result" && ((proof.chargeMillicents !== undefined && !amount(proof.chargeMillicents)) || envelope.status !== "succeeded")) ||
            (proof.kind !== "paid_result" && envelope.status !== "failed") ||
            (proof.kind === "no_charge" && proof.chargeMillicents !== 0) ||
            (proof.kind === "confirmed_refund" && (!amount(proof.chargeMillicents) || !amount(proof.refundMillicents) || proof.chargeMillicents !== proof.refundMillicents)))
            fail("Invalid settlement evidence");
        if (proof.deletedAt != null && (typeof proof.deletedAt !== "string" || !Number.isFinite(Date.parse(proof.deletedAt))))
            fail("Invalid deletion evidence");
        await this.db.query(`UPDATE campaigns.paid_designs SET settlement=$4,
      template_deleted_at=COALESCE(template_deleted_at,$5::timestamptz),updated_at=now()
      WHERE id=$1 AND scope=$2 AND owner_id=$3 AND status='pending'`, [intent.id, this.scope, this.owner, proof, proof.deletedAt ?? null]);
        if (proof.deletedAt)
            return;
        if (proof.kind === "paid_result") {
            await this.save(intent, object(envelope.result));
        }
        else {
            await this.db.query(`UPDATE campaigns.paid_designs SET status='failed',recovery_reason=$4,error=NULL,updated_at=now()
        WHERE id=$1 AND scope=$2 AND owner_id=$3 AND status='pending' AND template_deleted_at IS NULL`, [intent.id, this.scope, this.owner, proof.kind === "no_charge" ? "CENTRAL_NO_CHARGE" : "CENTRAL_CONFIRMED_REFUND"]);
        }
    }
    /** Operator authorization and audit are enforced by the route; no local override. */
    async resolve(id, reason) {
        if (!uuid.test(id) || typeof reason !== "string" || !reason.trim() || reason.length > 500)
            fail("Valid reference and resolution reason required", 400);
        const intent = (await this.db.query("SELECT * FROM campaigns.paid_designs WHERE id=$1 AND scope=$2 AND owner_id=$3", [id, this.scope, this.owner])).rows[0];
        if (!intent || intent.status !== "pending" || intent.template_deleted_at)
            fail("Unresolved payment not found for this owner and credential", 409);
        await this.verifyIdentity(intent);
        if (!this.bridge.resolvePaidResult)
            fail("Audited central resolution unavailable", 503);
        await this.consumeSettlement(intent, object(await this.bridge.resolvePaidResult(id, reason.trim())));
    }
    async list(templateId, operator = false, cursor) {
        const pending = await this.db.query(`SELECT * FROM campaigns.paid_designs
      WHERE scope=$1 AND owner_id=$2 AND status='pending' AND ($3::uuid IS NULL OR id=$3)
        AND (last_recovery_check_at IS NULL OR last_recovery_check_at <= now() - ($4::int * interval '1 second'))
        AND ($5::boolean OR recovery_checks<3)
      ORDER BY last_recovery_check_at NULLS FIRST,created_at,id LIMIT 5`, [this.scope, this.owner, templateId ?? null, operator ? 86400 : 30, operator]);
        await Promise.all(pending.rows.map(row => this.reconcile(row, operator)));
        await this.repairPreviews(templateId);
        const rows = await this.db.query(`SELECT p.*,
      NOT EXISTS (SELECT 1 FROM campaigns.entities e WHERE e.kind='templates' AND e.id=p.id) AS source_missing
       FROM campaigns.paid_designs p WHERE p.scope=$1 AND p.owner_id=$2
          AND ($3::uuid IS NULL OR p.id=$3)
          AND ($4::timestamptz IS NULL OR (p.created_at,p.id)<($4::timestamptz,$5::uuid))
          ORDER BY p.created_at DESC,p.id DESC LIMIT 101`, [this.scope, this.owner, templateId ?? null, cursor?.createdAt ?? null, cursor?.id ?? null]);
        const page = rows.rows.slice(0, 100);
        const tail = page.at(-1);
        return { items: page.map(row => ({ id: row.id, status: row.template_deleted_at && row.status === "succeeded" ? "deleted" : row.status === "pending" && row.recovery_checks >= 3 ? "needs_review" : row.status,
                templateId: row.status === "succeeded" && !row.template_deleted_at && !row.source_missing ? row.id : null,
                checks: row.recovery_checks ?? 0, lastCheckedAt: row.last_recovery_check_at ?? null, reason: row.recovery_reason ?? null,
                ...(row.status === "failed" && ["NOT_DISPATCHED", "CENTRAL_NO_CHARGE", "CENTRAL_CONFIRMED_REFUND"].includes(row.recovery_reason ?? "") ? { noChargeVerified: true } : {}),
                ...(row.status === "succeeded" && !row.template_deleted_at && row.source_missing
                    ? { sourceMissing: true, error: "Saved template is missing locally. Restore from its retained result after validation; no payment will be retried." }
                    : row.error ? { error: row.error } : {}) })),
            ...(rows.rows.length > 100 && tail ? { nextCursor: `${new Date(tail.created_at).toISOString()}|${tail.id}` } : {}) };
    }
}
//# sourceMappingURL=paid-designs.js.map