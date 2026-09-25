import { randomUUID } from "node:crypto";
import { Router } from "express";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalized(body, partial, http) {
    const allowed = ["name", "logoUrl", "color", "defaultFromName", "defaultFromEmail", "defaultReplyTo"];
    for (const key of Object.keys(body))
        if (!allowed.includes(key))
            throw http(400, `Unknown field: ${key}`);
    if (!partial || body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120)
            throw http(400, "Brand name must be 1-120 characters");
        body.name = body.name.trim();
    }
    if (body.logoUrl !== undefined && body.logoUrl !== null) {
        let url;
        try {
            url = new URL(String(body.logoUrl));
        }
        catch {
            throw http(400, "Brand logoUrl must be a valid HTTPS URL");
        }
        if (url.protocol !== "https:" || url.username || url.password || String(body.logoUrl).length > 2048)
            throw http(400, "Brand logoUrl must be a valid HTTPS URL");
        body.logoUrl = url.toString();
    }
    if (body.color !== undefined && body.color !== null && (typeof body.color !== "string" || !/^#[0-9a-f]{6}$/i.test(body.color)))
        throw http(400, "Brand color must be #RRGGBB");
    if (body.defaultFromName !== undefined && body.defaultFromName !== null && (typeof body.defaultFromName !== "string" || !body.defaultFromName.trim() || body.defaultFromName.length > 160))
        throw http(400, "Brand defaultFromName is invalid");
    for (const key of ["defaultFromEmail", "defaultReplyTo"]) {
        const value = body[key];
        if (value !== undefined && value !== null) {
            const address = String(value).trim().toLowerCase();
            if (address.length > 320 || !EMAIL.test(address))
                throw http(400, `Brand ${key} is invalid`);
            body[key] = address;
        }
    }
    return body;
}
const select = `SELECT id,name,logo_url "logoUrl",color,default_from_name "defaultFromName",
 default_from_email "defaultFromEmail",default_reply_to "defaultReplyTo",
 created_at "createdAt",updated_at "updatedAt" FROM campaigns.brands`;
export async function getBrandDefaults(db, scope, brandId) {
    if (brandId === undefined || brandId === null)
        return null;
    if (typeof brandId !== "string" || !UUID.test(brandId))
        throw Object.assign(new Error("brandId must be a UUID"), { status: 400 });
    const result = await db.query(`${select} WHERE scope=$1 AND id=$2`, [scope, brandId]);
    if (!result.rows[0])
        throw Object.assign(new Error("Unknown brand"), { status: 400 });
    return result.rows[0];
}
export function createBrandsRouter(deps) {
    const router = Router();
    router.get("/brands", deps.need(), deps.wrap(async (request, response) => {
        const p = deps.page(request), scope = await deps.scope();
        const search = String(request.query.search ?? "").trim().toLowerCase();
        if (search.length > 200)
            throw deps.http(400, "Search must not exceed 200 characters");
        const pattern = search ? `%${search}%` : null;
        const rows = await deps.db.query(`${select} WHERE scope=$1 AND ($2::text IS NULL OR lower(name) LIKE $2) ORDER BY updated_at DESC,id DESC LIMIT $3 OFFSET $4`, [scope, pattern, p.pageSize, p.offset]);
        const count = await deps.db.query("SELECT count(*)::text count FROM campaigns.brands WHERE scope=$1 AND ($2::text IS NULL OR lower(name) LIKE $2)", [scope, pattern]);
        response.json({ data: rows.rows, meta: { page: p.page, pageSize: p.pageSize, total: Number(count.rows[0]?.count ?? 0) } });
    }));
    router.post("/brands", deps.mutation, deps.need("brands:manage"), deps.wrap(async (request, response) => {
        const body = normalized(deps.json(request.body), false, deps.http), id = randomUUID(), scope = await deps.scope();
        try {
            await deps.db.query(`INSERT INTO campaigns.brands(id,scope,name,logo_url,color,default_from_name,default_from_email,default_reply_to)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, scope, body.name, body.logoUrl ?? null, body.color ?? null, body.defaultFromName ?? null, body.defaultFromEmail ?? null, body.defaultReplyTo ?? null]);
        }
        catch (error) {
            if (error.code === "23505")
                throw deps.http(409, "Brand name already exists");
            throw error;
        }
        const result = await deps.db.query(`${select} WHERE scope=$1 AND id=$2`, [scope, id]);
        await deps.audit(request, "brand.create", "brands", id);
        response.status(201).json({ data: result.rows[0] });
    }));
    router.get("/brands/:brandId", deps.need(), deps.wrap(async (request, response) => {
        const result = await deps.db.query(`${select} WHERE scope=$1 AND id=$2`, [await deps.scope(), String(request.params.brandId)]);
        if (!result.rows[0])
            throw deps.http(404, "Brand not found");
        response.json({ data: result.rows[0] });
    }));
    router.patch("/brands/:brandId", deps.mutation, deps.need("brands:manage"), deps.wrap(async (request, response) => {
        const body = normalized(deps.json(request.body), true, deps.http);
        if (!Object.keys(body).length)
            throw deps.http(400, "Patch must not be empty");
        const scope = await deps.scope(), id = String(request.params.brandId);
        const current = await deps.db.query(`${select} WHERE scope=$1 AND id=$2`, [scope, id]);
        if (!current.rows[0])
            throw deps.http(404, "Brand not found");
        const value = { ...current.rows[0], ...body };
        try {
            await deps.db.query(`UPDATE campaigns.brands SET name=$3,logo_url=$4,color=$5,default_from_name=$6,
        default_from_email=$7,default_reply_to=$8,updated_at=now() WHERE scope=$1 AND id=$2`, [scope, id, value.name, value.logoUrl ?? null, value.color ?? null, value.defaultFromName ?? null, value.defaultFromEmail ?? null, value.defaultReplyTo ?? null]);
        }
        catch (error) {
            if (error.code === "23505")
                throw deps.http(409, "Brand name already exists");
            throw error;
        }
        const result = await deps.db.query(`${select} WHERE scope=$1 AND id=$2`, [scope, id]);
        await deps.audit(request, "brand.update", "brands", id);
        response.json({ data: result.rows[0] });
    }));
    router.delete("/brands/:brandId", deps.mutation, deps.need("brands:manage"), deps.wrap(async (request, response) => {
        const scope = await deps.scope(), id = String(request.params.brandId);
        const references = await deps.db.query("SELECT count(*)::text count FROM campaigns.entities WHERE kind IN ('lists','templates','campaigns') AND body->>'brandId'=$1", [id]);
        if (Number(references.rows[0]?.count ?? 0))
            throw deps.http(409, "Brand is referenced by lists, templates, or campaigns");
        const deleted = await deps.db.query("DELETE FROM campaigns.brands WHERE scope=$1 AND id=$2", [scope, id]);
        if (!deleted.rowCount)
            throw deps.http(404, "Brand not found");
        await deps.audit(request, "brand.delete", "brands", id);
        response.status(204).end();
    }));
    return router;
}
//# sourceMappingURL=brands.js.map