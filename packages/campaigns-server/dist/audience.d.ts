import { Router, type Request } from "express";
export type CustomFieldType = "string" | "number" | "boolean" | "date" | "enum";
export interface CustomFieldDefinition {
    key: string;
    label: string;
    type: CustomFieldType;
    enumValues?: string[];
    required?: boolean;
}
export type Scalar = string | number | boolean | null;
export type AudienceField = "email" | "firstName" | "lastName" | "name" | "status" | "list" | "tag" | "custom";
export type ComparisonOperator = "eq" | "ne" | "contains" | "in" | "gt" | "gte" | "lt" | "lte" | "is_missing" | "is_null";
export type AudiencePredicate = {
    and: AudiencePredicate[];
} | {
    or: AudiencePredicate[];
} | {
    not: AudiencePredicate;
} | {
    field: AudienceField;
    operator: ComparisonOperator;
    value?: Scalar | Scalar[];
    customField?: string;
};
export interface CompiledPredicate {
    text: string;
    values: unknown[];
    nodeCount: number;
}
export declare class AudienceValidationError extends Error {
    readonly status = 400;
    constructor(message: string);
}
export declare function validateCustomFieldDefinitions(input: unknown): CustomFieldDefinition[];
export declare function validateCustomValues(input: unknown, definitions: CustomFieldDefinition[]): Record<string, Scalar>;
/**
 * Compiles the JSON predicate into PostgreSQL using only fixed SQL fragments and
 * positional values. `subscriberAlias` is deliberately not configurable.
 */
export declare function compileAudiencePredicate(predicate: unknown, definitions?: CustomFieldDefinition[], options?: {
    maxDepth?: number;
    maxNodes?: number;
}): CompiledPredicate;
export interface SavedSegment {
    id: string;
    scope: string;
    name: string;
    description?: string;
    predicate: AudiencePredicate;
    createdAt: string;
    updatedAt: string;
}
export interface AudiencePrincipal {
    id: string;
    permissions: readonly string[];
    /** null means unrestricted; an empty array means no lists. */
    listIds: readonly string[] | null;
}
export interface AudienceRequestContext {
    scope: string;
    principal: AudiencePrincipal;
}
export interface SegmentWrite {
    name: string;
    description?: string;
    predicate: AudiencePredicate;
}
export interface PreviewResult {
    count: number;
    sample: Array<{
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
    }>;
}
export interface AudienceRepository {
    listSegments(scope: string): Promise<SavedSegment[]>;
    listSegmentsPage?(scope: string, page: number, pageSize: number, search?: string): Promise<{
        rows: SavedSegment[];
        total: number;
    }>;
    getSegment(scope: string, id: string): Promise<SavedSegment | null>;
    createSegment(scope: string, id: string, input: SegmentWrite): Promise<SavedSegment>;
    updateSegment(scope: string, id: string, input: SegmentWrite): Promise<SavedSegment | null>;
    deleteSegment(scope: string, id: string): Promise<boolean>;
    preview(scope: string, compiled: CompiledPredicate, allowedListIds: readonly string[] | null, limit: number): Promise<PreviewResult>;
    recipients(scope: string, source: AudienceSource, allowedListIds: readonly string[] | null): Promise<Recipient[]>;
}
export interface AudienceDatabase {
    query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{
        rows: T[];
        rowCount?: number | null;
    }>;
}
/**
 * PostgreSQL repository factory. Subscriber entities are required to carry an
 * explicit `body.scope`; integration must backfill it before enabling audiences.
 */
export declare function createPostgresAudienceRepository(database: AudienceDatabase): AudienceRepository;
export interface AudienceRouterOptions {
    repository: AudienceRepository;
    context(request: Request): Promise<AudienceRequestContext> | AudienceRequestContext;
    customFields(scope: string): Promise<CustomFieldDefinition[]> | CustomFieldDefinition[];
    id?: () => string;
}
export declare function createAudienceRouter(options: AudienceRouterOptions): Router;
export interface AudienceSource {
    listIds?: string[];
    segmentIds?: string[];
}
export interface Recipient {
    id: string;
    email: string;
    status: string;
    [key: string]: unknown;
}
export interface AudienceSnapshot {
    scope: string;
    generatedAt: string;
    source: {
        listIds: string[];
        segmentIds: string[];
    };
    recipientIds: string[];
    recipients: Recipient[];
}
export declare function createAudienceSnapshot(repository: AudienceRepository, scope: string, source: AudienceSource, allowedListIds: readonly string[] | null, generatedAt?: string): Promise<AudienceSnapshot>;
export type MissingVariablePolicy = "error" | "empty" | "keep";
export declare function renderMergeVariables(template: string, variables: Record<string, unknown>, options: {
    format: "html" | "text";
    missing: MissingVariablePolicy;
}): string;
//# sourceMappingURL=audience.d.ts.map