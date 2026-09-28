/**
 * Mailjet emits MessageID (and message-list ID) as JSON integers that can exceed JS's safe integer
 * range. Quote only numeric ID values while scanning JSON strings as tokens;
 * JSON.parse still validates the complete document (including malformed JSON).
 * Never convert an ID after JSON.parse: the original digits are already lost.
 */
export function parseMailjetJson(raw) {
    let output = "";
    let previous = 0;
    for (let i = 0; i < raw.length;) {
        if (raw[i] !== '"') {
            i++;
            continue;
        }
        const start = i++;
        while (i < raw.length) {
            if (raw[i] === "\\") {
                i += 2;
                continue;
            }
            if (raw[i++] === '"')
                break;
        }
        if (raw[i - 1] !== '"')
            break; // JSON.parse will report the invalid string.
        const key = JSON.parse(raw.slice(start, i));
        if (key !== "MessageID" && key !== "message_id" && key !== "ID")
            continue;
        let at = i;
        while (/\s/.test(raw[at] ?? "") && at < raw.length)
            at++;
        if (raw[at] !== ":")
            continue; // This was a string value, not a key.
        at++;
        while (/\s/.test(raw[at] ?? "") && at < raw.length)
            at++;
        const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(at));
        if (!match || !/[\s,}\]]/.test(raw[at + match[0].length] ?? ""))
            continue;
        output += raw.slice(previous, at) + JSON.stringify(match[0]);
        previous = at + match[0].length;
        i = previous;
    }
    return JSON.parse(output + raw.slice(previous));
}
//# sourceMappingURL=mailjet-json.js.map