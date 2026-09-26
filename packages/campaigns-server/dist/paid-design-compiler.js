import { Worker } from "node:worker_threads";
import { sanitizeWebVersionHtml } from "./domains-tracking.js";
/** Free local derivation. Neither source nor payment status depends on it. */
export async function compilePaidDesign(metadata) {
    if (Buffer.byteLength(JSON.stringify(metadata)) > 2 * 1024 * 1024)
        throw new Error("SOURCE_LIMIT");
    const generated = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./paid-design-compiler-worker.cjs", import.meta.url), {
            workerData: metadata, resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
        });
        const timeout = setTimeout(() => { void worker.terminate(); reject(new Error("COMPILE_TIMEOUT")); }, 6_000);
        worker.once("message", (value) => {
            clearTimeout(timeout);
            void worker.terminate();
            if (value.error || !value.html)
                reject(new Error(value.error ?? "EMPTY_COMPILE_OUTPUT"));
            else
                resolve(value.html);
        });
        worker.once("error", () => { clearTimeout(timeout); reject(new Error("COMPILER_UNAVAILABLE")); });
        worker.once("exit", () => { clearTimeout(timeout); reject(new Error("COMPILER_EXIT")); });
    });
    // Use the existing server-side email/web-preview sanitizer, not source
    // conversion. Preserve full canonical MJML/native JSON independently.
    const safe = sanitizeWebVersionHtml(generated);
    if (!safe.trim())
        throw new Error("EMPTY_SAFE_PREVIEW");
    return safe;
}
//# sourceMappingURL=paid-design-compiler.js.map