import express from "express";
import { resolve } from "node:path";
/** HTTP composition shared by the standalone CLI and its isolated routing tests. */
export function createStandaloneCampaignsApp({ campaignsRouter, publicDir, trustProxy = false, }) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", trustProxy ? 1 : false);
    app.use(express.json({ limit: "4mb", type: ["application/json", "application/*+json"],
        verify: (request, _response, buffer) => {
            // Preserve integer Mailjet MessageID before JSON.parse rounds it.
            if (/^\/api\/campaigns\/webhooks\//.test(request.url ?? ""))
                request.rawWebhookBody = Buffer.from(buffer);
        },
    }));
    // Only the standalone site's exact root redirects. Express also handles HEAD
    // for this GET route. Keep the raw query, but never derive the target from a
    // Host/forwarded header or a user-supplied next/redirect parameter.
    app.get(/^\/$/, (request, response) => {
        const queryStart = request.originalUrl.indexOf("?");
        const query = queryStart < 0 ? "" : request.originalUrl.slice(queryStart);
        response.redirect(302, `/campaigns/${query}`);
    });
    app.get(/^\/campaigns\/install\/?$/i, async (request, response, next) => {
        response.set("Cache-Control", "no-store");
        response.set("Referrer-Policy", "no-referrer");
        try {
            if (await campaignsRouter.isInstalled()) {
                // lang is the only query used by the locale picker. Normalize to a
                // supported code; never forward installer credentials or next URLs.
                const queryStart = request.originalUrl.indexOf("?");
                const language = new URLSearchParams(queryStart < 0 ? "" : request.originalUrl.slice(queryStart)).get("lang");
                const locale = language?.trim().toLowerCase().split(/[-_]/, 1)[0];
                const supported = ["en", "ru", "uk", "hi", "de", "fr", "es", "it", "pt", "ar", "id", "tr", "zh", "vi"];
                response.redirect(302, `/campaigns/login${locale && supported.includes(locale) ? `?lang=${locale}` : ""}`);
                return;
            }
        }
        catch {
            response.status(503).type("text").send("Campaigns installation status could not be confirmed. Please try again.");
            return;
        }
        next();
    });
    app.use(campaignsRouter.publicTrackingRouter);
    // Preserve links already sent by older releases that placed the public
    // tracking route beneath the standalone UI prefix.
    app.use("/campaigns", campaignsRouter.publicTrackingRouter);
    app.use("/api/campaigns", campaignsRouter);
    if (publicDir) {
        app.use("/campaigns", express.static(resolve(publicDir), { index: "index.html", fallthrough: true }));
        app.get("/campaigns/*path", (_request, response) => response.sendFile(resolve(publicDir, "index.html")));
    }
    return app;
}
//# sourceMappingURL=standalone-app.js.map