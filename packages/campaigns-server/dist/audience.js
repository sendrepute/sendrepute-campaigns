import { randomUUID } from "node:crypto";
import { Router } from "express";
export class AudienceValidationError extends Error {
    status = 400;
    constructor(message) {
        super(message);
        this.name = "AudienceValidationError";
    }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z)?$/;
const MAX_NODES = 100;
const MAX_DEPTH = 8;
function own(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
export function validateCustomFieldDefinitions(input) {
    if (!Array.isArray(input) || input.length > 100)
        throw new AudienceValidationError("custom field definitions must be an array of at most 100 items");
    const keys = new Set();
    return input.map((raw, index) => {
        if (!plainObject(raw))
            throw new AudienceValidationError(`custom field definition ${index} must be an object`);
        const key = raw.key;
        const label = raw.label;
        const type = raw.type;
        if (typeof key !== "string" || !KEY.test(key))
            throw new AudienceValidationError(`custom field definition ${index} has an invalid key`);
        if (keys.has(key))
            throw new AudienceValidationError(`duplicate custom field key: ${key}`);
        keys.add(key);
        if (typeof label !== "string" || !label.trim() || label.length > 100)
            throw new AudienceValidationError(`custom field ${key} has an invalid label`);
        if (!["string", "number", "boolean", "date", "enum"].includes(String(type)))
            throw new AudienceValidationError(`custom field ${key} has an invalid type`);
        let enumValues;
        if (type === "enum") {
            if (!Array.isArray(raw.enumValues) || raw.enumValues.length === 0 || raw.enumValues.length > 100) {
                throw new AudienceValidationError(`enum custom field ${key} requires 1-100 values`);
            }
            enumValues = raw.enumValues.map((entry) => {
                if (typeof entry !== "string" || !entry || entry.length > 100)
                    throw new AudienceValidationError(`enum custom field ${key} has an invalid value`);
                return entry;
            });
            if (new Set(enumValues).size !== enumValues.length)
                throw new AudienceValidationError(`enum custom field ${key} has duplicate values`);
        }
        else if (raw.enumValues !== undefined) {
            throw new AudienceValidationError(`only enum custom fields may define enumValues`);
        }
        if (raw.required !== undefined && typeof raw.required !== "boolean")
            throw new AudienceValidationError(`custom field ${key} required must be boolean`);
        return { key, label: label.trim(), type: type, ...(enumValues ? { enumValues } : {}), ...(raw.required === undefined ? {} : { required: raw.required }) };
    });
}
export function validateCustomValues(input, definitions) {
    if (!plainObject(input))
        throw new AudienceValidationError("custom values must be an object");
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    for (const key of Object.keys(input))
        if (!byKey.has(key))
            throw new AudienceValidationError(`unknown custom field: ${key}`);
    const result = {};
    for (const definition of definitions) {
        const value = input[definition.key];
        if (value === undefined) {
            if (definition.required)
                throw new AudienceValidationError(`custom field ${definition.key} is required`);
            continue;
        }
        if (value === null) {
            if (definition.required)
                throw new AudienceValidationError(`custom field ${definition.key} cannot be null`);
            result[definition.key] = null;
            continue;
        }
        if (definition.type === "string" && (typeof value !== "string" || value.length > 10_000))
            throw new AudienceValidationError(`custom field ${definition.key} must be a string`);
        if (definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value)))
            throw new AudienceValidationError(`custom field ${definition.key} must be a finite number`);
        if (definition.type === "boolean" && typeof value !== "boolean")
            throw new AudienceValidationError(`custom field ${definition.key} must be boolean`);
        if (definition.type === "date" && (typeof value !== "string" || !validDate(value)))
            throw new AudienceValidationError(`custom field ${definition.key} must be an ISO date`);
        if (definition.type === "enum" && (typeof value !== "string" || !definition.enumValues?.includes(value)))
            throw new AudienceValidationError(`custom field ${definition.key} is not an allowed enum value`);
        result[definition.key] = value;
    }
    return result;
}
function validDate(value) {
    return DATE.test(value) && !Number.isNaN(Date.parse(value));
}
function validateScalar(value, type) {
    if (type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value))
            throw new AudienceValidationError("comparison value must be a finite number");
    }
    else if (type === "boolean") {
        if (typeof value !== "boolean")
            throw new AudienceValidationError("comparison value must be boolean");
    }
    else if (type === "date") {
        if (typeof value !== "string" || !validDate(value))
            throw new AudienceValidationError("comparison value must be an ISO date");
    }
    else if (type === "uuid") {
        if (typeof value !== "string" || !UUID.test(value))
            throw new AudienceValidationError("list comparison value must be a UUID");
    }
    else {
        if (typeof value !== "string" || value.length > 10_000)
            throw new AudienceValidationError("comparison value must be a string");
        if (type === "status" && !["subscribed", "unsubscribed", "bounced", "complained", "pending"].includes(value)) {
            throw new AudienceValidationError("invalid subscriber status");
        }
    }
    return value;
}
/**
 * Compiles the JSON predicate into PostgreSQL using only fixed SQL fragments and
 * positional values. `subscriberAlias` is deliberately not configurable.
 */
export function compileAudiencePredicate(predicate, definitions = [], options = {}) {
    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH);
    const maxNodes = Math.min(options.maxNodes ?? MAX_NODES, MAX_NODES);
    const fields = new Map(definitions.map((definition) => [definition.key, definition]));
    const values = [];
    let nodeCount = 0;
    const parameter = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    const visit = (raw, depth) => {
        if (depth > maxDepth)
            throw new AudienceValidationError(`predicate exceeds maximum depth ${maxDepth}`);
        if (++nodeCount > maxNodes)
            throw new AudienceValidationError(`predicate exceeds maximum node count ${maxNodes}`);
        if (!plainObject(raw))
            throw new AudienceValidationError("predicate node must be an object");
        const keys = Object.keys(raw);
        if (own(raw, "and") || own(raw, "or")) {
            if (keys.length !== 1)
                throw new AudienceValidationError("logical predicate nodes cannot contain extra properties");
            const kind = own(raw, "and") ? "and" : "or";
            const children = raw[kind];
            if (!Array.isArray(children) || children.length < 1 || children.length > maxNodes)
                throw new AudienceValidationError(`${kind} must contain a non-empty bounded array`);
            return `(${children.map((child) => visit(child, depth + 1)).join(kind === "and" ? " AND " : " OR ")})`;
        }
        if (own(raw, "not")) {
            if (keys.length !== 1)
                throw new AudienceValidationError("not predicate cannot contain extra properties");
            return `(NOT ${visit(raw.not, depth + 1)})`;
        }
        const allowedKeys = new Set(["field", "operator", "value", "customField"]);
        if (keys.some((key) => !allowedKeys.has(key)))
            throw new AudienceValidationError("comparison predicate contains an unknown property");
        const field = raw.field;
        const operator = raw.operator;
        if (!["email", "firstName", "lastName", "name", "status", "list", "tag", "custom"].includes(String(field)))
            throw new AudienceValidationError("invalid audience field");
        if (!["eq", "ne", "contains", "in", "gt", "gte", "lt", "lte", "is_missing", "is_null"].includes(String(operator)))
            throw new AudienceValidationError("invalid comparison operator");
        let expression;
        let jsonExpression;
        let type = "string";
        let customDefinition;
        if (field === "email")
            expression = "s.body->>'email'";
        else if (field === "firstName")
            expression = "s.body->>'firstName'";
        else if (field === "lastName")
            expression = "s.body->>'lastName'";
        else if (field === "name")
            expression = "concat_ws(' ', s.body->>'firstName', s.body->>'lastName')";
        else if (field === "status") {
            expression = "s.body->>'status'";
            type = "status";
        }
        else if (field === "list") {
            expression = "s.body->'listIds'";
            type = "uuid";
        }
        else if (field === "tag")
            expression = "s.body->'tags'";
        else {
            if (typeof raw.customField !== "string" || !KEY.test(raw.customField))
                throw new AudienceValidationError("custom predicate requires a valid customField");
            const definition = fields.get(raw.customField);
            if (!definition)
                throw new AudienceValidationError(`unknown custom field: ${raw.customField}`);
            customDefinition = definition;
            const key = parameter(raw.customField);
            jsonExpression = `(s.body->'metadata')->${key}`;
            expression = `(s.body->'metadata')->>${key}`;
            type = definition.type;
        }
        if (field !== "custom" && raw.customField !== undefined)
            throw new AudienceValidationError("customField is only valid with the custom field");
        if (operator === "is_missing") {
            if (own(raw, "value"))
                throw new AudienceValidationError("is_missing does not accept a value");
            if (field === "list" || field === "tag")
                return `(${expression} IS NULL)`;
            return `(${jsonExpression ? `${jsonExpression} IS NULL` : `${expression} IS NULL`})`;
        }
        if (operator === "is_null") {
            if (own(raw, "value"))
                throw new AudienceValidationError("is_null does not accept a value");
            if (!jsonExpression)
                throw new AudienceValidationError("is_null is only supported for custom fields");
            return `(${jsonExpression} = 'null'::jsonb)`;
        }
        if (!own(raw, "value") || raw.value === null)
            throw new AudienceValidationError(`${operator} requires a non-null value`);
        if (field === "list" || field === "tag") {
            if (!["eq", "ne", "in"].includes(String(operator)))
                throw new AudienceValidationError(`${field} supports only eq, ne, in, and is_missing`);
            const rawValues = operator === "in" ? raw.value : [raw.value];
            if (!Array.isArray(rawValues) || rawValues.length < 1 || rawValues.length > 100)
                throw new AudienceValidationError("in requires 1-100 values");
            const checked = rawValues.map((value) => validateScalar(value, field === "list" ? "uuid" : "string"));
            const p = parameter(checked);
            const exists = `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(${expression}, '[]'::jsonb)) AS av(value) WHERE av.value = ANY(${p}::text[]))`;
            return operator === "ne" ? `(NOT ${exists} AND ${expression} IS NOT NULL)` : `(${exists})`;
        }
        const allowed = type === "number" || type === "date"
            ? ["eq", "ne", "in", "gt", "gte", "lt", "lte"]
            : type === "boolean" || type === "enum" || type === "status"
                ? ["eq", "ne", "in"]
                : ["eq", "ne", "contains", "in"];
        if (!allowed.includes(String(operator)))
            throw new AudienceValidationError(`operator ${operator} is not valid for ${type}`);
        if (operator === "in") {
            if (!Array.isArray(raw.value) || raw.value.length < 1 || raw.value.length > 100)
                throw new AudienceValidationError("in requires 1-100 values");
            const checked = raw.value.map((value) => validateScalar(value, type));
            if (type === "enum" && checked.some((value) => !customDefinition?.enumValues?.includes(String(value)))) {
                throw new AudienceValidationError(`custom field ${customDefinition?.key} has a comparison value outside its enum`);
            }
            if (type === "number")
                return `((${expression})::numeric = ANY(${parameter(checked)}::numeric[]) AND ${expression} IS NOT NULL)`;
            if (type === "boolean")
                return `((${expression})::boolean = ANY(${parameter(checked)}::boolean[]) AND ${expression} IS NOT NULL)`;
            if (type === "date")
                return `((${expression})::timestamptz = ANY(${parameter(checked)}::timestamptz[]) AND ${expression} IS NOT NULL)`;
            return `(${expression} = ANY(${parameter(checked)}::text[]) AND ${expression} IS NOT NULL)`;
        }
        const checked = validateScalar(raw.value, type);
        if (type === "enum" && !customDefinition?.enumValues?.includes(String(checked))) {
            throw new AudienceValidationError(`custom field ${customDefinition?.key} has a comparison value outside its enum`);
        }
        if (operator === "contains")
            return `(POSITION(lower(${parameter(checked)}) IN lower(${expression})) > 0 AND ${expression} IS NOT NULL)`;
        const sqlOperator = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator];
        const cast = type === "number" ? "::numeric" : type === "boolean" ? "::boolean" : type === "date" ? "::timestamptz" : "";
        return `((${expression})${cast} ${sqlOperator} ${parameter(checked)}${cast} AND ${expression} IS NOT NULL)`;
    };
    return { text: visit(predicate, 1), values, nodeCount };
}
function shiftParameters(text, offset) {
    return text.replace(/\$(\d+)/g, (_, value) => `$${Number(value) + offset}`);
}
function savedSegment(row) {
    return {
        id: row.id,
        scope: row.scope,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        predicate: row.predicate,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
    };
}
/**
 * PostgreSQL repository factory. Subscriber entities are required to carry an
 * explicit `body.scope`; integration must backfill it before enabling audiences.
 */
export function createPostgresAudienceRepository(database) {
    const definitions = async (scope) => {
        const result = await database.query("SELECT definition FROM campaigns.audience_custom_fields WHERE scope=$1 ORDER BY key", [scope]);
        return validateCustomFieldDefinitions(result.rows.map((row) => row.definition));
    };
    const visibility = (values, allowed) => {
        if (allowed === null)
            return "TRUE";
        values.push([...allowed]);
        return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.body->'listIds','[]'::jsonb)) visible_list(value) WHERE visible_list.value = ANY($${values.length}::text[]))`;
    };
    const preview = async (scope, compiled, allowed, limit) => {
        const values = [...compiled.values, scope];
        const scopeParameter = `$${values.length}`;
        const visible = visibility(values, allowed);
        values.push(limit);
        const limitParameter = `$${values.length}`;
        const result = await database.query(`WITH matched AS (
         SELECT s.id, s.body->>'email' AS email, s.body->>'firstName' AS "firstName", s.body->>'lastName' AS "lastName"
         FROM campaigns.entities s
         WHERE s.kind='subscribers'
           AND s.body->>'scope'=${scopeParameter}
           AND s.body->>'status'='subscribed'
           AND ${visible}
           AND ${compiled.text}
       )
       SELECT
         (SELECT count(*) FROM matched) AS count,
         COALESCE((
           SELECT jsonb_agg(to_jsonb(sample) ORDER BY sample.id)
           FROM (SELECT id, email, "firstName", "lastName" FROM matched ORDER BY id LIMIT ${limitParameter}) sample
         ), '[]'::jsonb) AS sample`, values);
        const row = result.rows[0];
        const sample = Array.isArray(row?.sample) ? row.sample : [];
        return { count: Number(row?.count ?? 0), sample: sample };
    };
    return {
        async listSegments(scope) {
            const result = await database.query("SELECT * FROM campaigns.audience_segments WHERE scope=$1 ORDER BY updated_at DESC,id", [scope]);
            return result.rows.map(savedSegment);
        },
        async listSegmentsPage(scope, page, pageSize, search) {
            const pattern = search ? `%${search.toLowerCase()}%` : null;
            const count = await database.query("SELECT count(*)::text count FROM campaigns.audience_segments WHERE scope=$1 AND ($2::text IS NULL OR lower(name) LIKE $2)", [scope, pattern]);
            const result = await database.query("SELECT * FROM campaigns.audience_segments WHERE scope=$1 AND ($2::text IS NULL OR lower(name) LIKE $2) ORDER BY updated_at DESC,id DESC LIMIT $3 OFFSET $4", [scope, pattern, pageSize, (page - 1) * pageSize]);
            return { rows: result.rows.map(savedSegment), total: Number(count.rows[0]?.count ?? 0) };
        },
        async getSegment(scope, id) {
            const result = await database.query("SELECT * FROM campaigns.audience_segments WHERE scope=$1 AND id=$2", [scope, id]);
            return result.rows[0] ? savedSegment(result.rows[0]) : null;
        },
        async createSegment(scope, id, input) {
            const result = await database.query(`INSERT INTO campaigns.audience_segments(scope,id,name,description,predicate)
         VALUES($1,$2,$3,$4,$5) RETURNING *`, [scope, id, input.name, input.description ?? null, input.predicate]);
            return savedSegment(result.rows[0]);
        },
        async updateSegment(scope, id, input) {
            const result = await database.query(`UPDATE campaigns.audience_segments
         SET name=$3,description=$4,predicate=$5,updated_at=now()
         WHERE scope=$1 AND id=$2 RETURNING *`, [scope, id, input.name, input.description ?? null, input.predicate]);
            return result.rows[0] ? savedSegment(result.rows[0]) : null;
        },
        async deleteSegment(scope, id) {
            const result = await database.query("DELETE FROM campaigns.audience_segments WHERE scope=$1 AND id=$2", [scope, id]);
            return Number(result.rowCount ?? 0) > 0;
        },
        preview,
        async recipients(scope, source, allowed) {
            const listIds = validateIds(source.listIds ?? [], "list");
            const segmentIds = validateIds(source.segmentIds ?? [], "segment");
            const segmentResult = segmentIds.length
                ? await database.query("SELECT id,predicate FROM campaigns.audience_segments WHERE scope=$1 AND id=ANY($2::uuid[]) ORDER BY id", [scope, segmentIds])
                : { rows: [] };
            if (segmentResult.rows.length !== segmentIds.length)
                throw new AudienceValidationError("one or more segments do not exist in this scope");
            const customFields = await definitions(scope);
            const values = [scope];
            const sourceClauses = [];
            if (listIds.length) {
                values.push(listIds);
                sourceClauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.body->'listIds','[]'::jsonb)) source_list(value) WHERE source_list.value = ANY($${values.length}::text[]))`);
            }
            for (const segment of segmentResult.rows) {
                const compiled = compileAudiencePredicate(segment.predicate, customFields);
                sourceClauses.push(shiftParameters(compiled.text, values.length));
                values.push(...compiled.values);
            }
            if (!sourceClauses.length)
                throw new AudienceValidationError("at least one list or segment is required");
            const visible = visibility(values, allowed);
            const result = await database.query(`SELECT s.body
         FROM campaigns.entities s
         WHERE s.kind='subscribers'
           AND s.body->>'scope'=$1
           AND s.body->>'status'='subscribed'
           AND ${visible}
           AND (${sourceClauses.join(" OR ")})
         ORDER BY s.id`, values);
            return result.rows.map((row) => row.body);
        },
    };
}
function assertPermission(context, permission) {
    if (!context.principal.permissions.includes(permission))
        throw Object.assign(new Error("Forbidden"), { status: 403 });
}
function parseSegmentWrite(value, definitions) {
    if (!plainObject(value))
        throw new AudienceValidationError("request body must be an object");
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 120)
        throw new AudienceValidationError("name must be 1-120 characters");
    if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 1000))
        throw new AudienceValidationError("description must be at most 1000 characters");
    compileAudiencePredicate(value.predicate, definitions);
    return { name: value.name.trim(), ...(value.description ? { description: value.description } : {}), predicate: value.predicate };
}
function segmentId(value) {
    if (typeof value !== "string" || !UUID.test(value))
        throw new AudienceValidationError("segment id must be a UUID");
    return value;
}
export function createAudienceRouter(options) {
    const router = Router();
    const run = (handler, success = 200) => async (request, response) => {
        try {
            const data = await handler(request);
            response.status(success).json({ data });
        }
        catch (error) {
            const status = typeof error?.status === "number" ? error.status : 500;
            response.status(status).json({ error: { message: status === 500 ? "Internal server error" : String(error.message) } });
        }
    };
    router.get("/segments", async (request, response) => {
        try {
            const context = await options.context(request);
            assertPermission(context, "audiences:read");
            const page = Math.max(1, Number(request.query.page ?? 1) || 1);
            const pageSize = Math.max(1, Math.min(100, Number(request.query.pageSize ?? 25) || 25));
            const search = String(request.query.search ?? "").trim();
            if (search.length > 200)
                throw new AudienceValidationError("search must not exceed 200 characters");
            const result = options.repository.listSegmentsPage
                ? await options.repository.listSegmentsPage(context.scope, page, pageSize, search || undefined)
                : await options.repository.listSegments(context.scope).then(rows => {
                    const filtered = search ? rows.filter(row => row.name.toLowerCase().includes(search.toLowerCase())) : rows;
                    return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
                });
            response.json({ data: result.rows, meta: { page, pageSize, total: result.total } });
        }
        catch (error) {
            const status = typeof error?.status === "number" ? error.status : 500;
            response.status(status).json({ error: { message: status === 500 ? "Internal server error" : String(error.message) } });
        }
    });
    router.get("/segments/:id", run(async (request) => {
        const context = await options.context(request);
        assertPermission(context, "audiences:read");
        const segment = await options.repository.getSegment(context.scope, segmentId(request.params.id));
        if (!segment)
            throw Object.assign(new Error("Segment not found"), { status: 404 });
        return segment;
    }));
    router.post("/segments", run(async (request) => {
        const context = await options.context(request);
        assertPermission(context, "audiences:manage");
        return options.repository.createSegment(context.scope, (options.id ?? randomUUID)(), parseSegmentWrite(request.body, await options.customFields(context.scope)));
    }, 201));
    router.put("/segments/:id", run(async (request) => {
        const context = await options.context(request);
        assertPermission(context, "audiences:manage");
        const segment = await options.repository.updateSegment(context.scope, segmentId(request.params.id), parseSegmentWrite(request.body, await options.customFields(context.scope)));
        if (!segment)
            throw Object.assign(new Error("Segment not found"), { status: 404 });
        return segment;
    }));
    router.delete("/segments/:id", run(async (request) => {
        const context = await options.context(request);
        assertPermission(context, "audiences:manage");
        if (!await options.repository.deleteSegment(context.scope, segmentId(request.params.id)))
            throw Object.assign(new Error("Segment not found"), { status: 404 });
        return { deleted: true };
    }));
    router.post("/preview", run(async (request) => {
        const context = await options.context(request);
        assertPermission(context, "audiences:read");
        const definitions = await options.customFields(context.scope);
        const body = plainObject(request.body) ? request.body : {};
        const predicate = own(body, "predicate") ? body.predicate : (await options.repository.getSegment(context.scope, String(body.segmentId ?? "")))?.predicate;
        if (!predicate)
            throw new AudienceValidationError("predicate or an existing segmentId is required");
        const limit = body.limit === undefined ? 20 : body.limit;
        if (!Number.isInteger(limit) || Number(limit) < 0 || Number(limit) > 100)
            throw new AudienceValidationError("limit must be an integer from 0 to 100");
        return options.repository.preview(context.scope, compileAudiencePredicate(predicate, definitions), context.principal.listIds, Number(limit));
    }));
    return router;
}
export async function createAudienceSnapshot(repository, scope, source, allowedListIds, generatedAt = new Date().toISOString()) {
    if (!scope)
        throw new AudienceValidationError("scope is required");
    const listIds = validateIds(source.listIds ?? [], "list");
    const segmentIds = validateIds(source.segmentIds ?? [], "segment");
    if (!listIds.length && !segmentIds.length)
        throw new AudienceValidationError("at least one list or segment is required");
    if (allowedListIds && listIds.some((id) => !allowedListIds.includes(id)))
        throw Object.assign(new Error("Forbidden list"), { status: 403 });
    const rows = await repository.recipients(scope, { listIds, segmentIds }, allowedListIds);
    const byId = new Map();
    for (const recipient of rows) {
        if (recipient.status === "subscribed" && UUID.test(recipient.id) && EMAIL.test(recipient.email))
            byId.set(recipient.id, recipient);
    }
    const recipients = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { scope, generatedAt, source: { listIds: [...listIds].sort(), segmentIds: [...segmentIds].sort() }, recipientIds: recipients.map((item) => item.id), recipients };
}
function validateIds(values, label) {
    if (!Array.isArray(values) || values.length > 1000 || values.some((value) => typeof value !== "string" || !UUID.test(value))) {
        throw new AudienceValidationError(`${label} IDs must be an array of at most 1000 UUIDs`);
    }
    return [...new Set(values)];
}
export function renderMergeVariables(template, variables, options) {
    if (typeof template !== "string" || template.length > 2_000_000)
        throw new AudienceValidationError("template must be a string no larger than 2 MB");
    if (!plainObject(variables))
        throw new AudienceValidationError("variables must be an object");
    return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g, (token, key) => {
        if (!own(variables, key) || variables[key] === undefined || variables[key] === null) {
            if (options.missing === "error")
                throw new AudienceValidationError(`missing merge variable: ${key}`);
            return options.missing === "keep" ? token : "";
        }
        const value = variables[key];
        if (!["string", "number", "boolean"].includes(typeof value))
            throw new AudienceValidationError(`merge variable ${key} must be scalar`);
        const text = String(value);
        return options.format === "html"
            ? text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
            : text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    });
}
//# sourceMappingURL=audience.js.map