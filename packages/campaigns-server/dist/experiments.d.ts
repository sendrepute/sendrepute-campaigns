import { Router, type Request } from "express";
import { type AudienceSnapshot } from "./audience.js";
import type { DeliveryDb, Json } from "./delivery-reliability.js";
type Deps = {
    db: DeliveryDb;
    need: (permission: string) => any;
    mutation: any;
    wrap: (fn: any) => any;
    http: (status: number, message: string) => Error;
    scope: (db: DeliveryDb) => Promise<string>;
    lists: (request: Request) => string[] | null;
    allowed: (request: Request, campaign: Json) => void;
    activation: () => Promise<unknown>;
    now: () => Date;
    resolveAudience: (db: DeliveryDb, scope: string, campaign: Json, allowed: string[] | null, generatedAt: string) => Promise<AudienceSnapshot>;
};
export declare function partitionAudience(id: string, recipients: Json[], percent: number): {
    subscriber: Json;
    arm: string;
}[];
export declare function experimentDecision(results: any, minimum: number, ready: boolean): {
    winner: null;
    reason: string;
} | {
    winner: string;
    reason: string;
};
export declare function createExperimentsRouter(d: Deps): Router;
export {};
//# sourceMappingURL=experiments.d.ts.map