#!/usr/bin/env node
import { resolve } from "node:path";
import { campaignsDatabaseUrl, createCampaignsRouter, startCampaignsWorker } from "./index.js";
import { createStandaloneCampaignsApp } from "./standalone-app.js";
const databaseUrl = campaignsDatabaseUrl();
if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
}
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be an integer from 1 to 65535");
    process.exit(1);
}
const dataDir = process.env.CAMPAIGNS_DATA_DIR;
const publicDir = process.env.CAMPAIGNS_PUBLIC_DIR;
const campaignsRouter = createCampaignsRouter({ databaseUrl, dataDir });
const app = createStandaloneCampaignsApp({
    campaignsRouter,
    publicDir,
    trustProxy: process.env.CAMPAIGNS_TRUST_PROXY === "true",
});
app.listen(port, () => {
    console.log(`SendRepute Campaigns listening on http://127.0.0.1:${port}`);
    console.log(`Installer token: ${resolve(dataDir ?? ".campaigns-data", "installer-token")}`);
    console.warn("Amazon SES webhooks require provider metadata.snsTopicArns. SNS signatures are verified by default; subscription confirmation must be completed explicitly with AWS CLI or console.");
});
const configuredInterval = Number(process.env.CAMPAIGNS_WORKER_INTERVAL_MS ?? 5000);
if (!Number.isFinite(configuredInterval) || configuredInterval < 1000) {
    console.error("CAMPAIGNS_WORKER_INTERVAL_MS must be a number of at least 1000");
    process.exit(1);
}
const interval = configuredInterval;
startCampaignsWorker({
    databaseUrl,
    dataDir,
    intervalMs: interval,
    onError: error => {
        console.error("Campaign worker iteration failed:", error instanceof Error ? error.message : "unknown error");
    },
});
//# sourceMappingURL=cli.js.map