import { type Express, type Router } from "express";
/** HTTP composition shared by the standalone CLI and its isolated routing tests. */
export declare function createStandaloneCampaignsApp({ campaignsRouter, publicDir, trustProxy, }: {
    campaignsRouter: Router & {
        publicTrackingRouter: Router;
        isInstalled: () => Promise<boolean>;
    };
    publicDir?: string;
    trustProxy?: boolean;
}): Express;
//# sourceMappingURL=standalone-app.d.ts.map