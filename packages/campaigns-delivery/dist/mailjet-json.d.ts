/**
 * Mailjet emits MessageID (and message-list ID) as JSON integers that can exceed JS's safe integer
 * range. Quote only numeric ID values while scanning JSON strings as tokens;
 * JSON.parse still validates the complete document (including malformed JSON).
 * Never convert an ID after JSON.parse: the original digits are already lost.
 */
export declare function parseMailjetJson(raw: string): unknown;
//# sourceMappingURL=mailjet-json.d.ts.map