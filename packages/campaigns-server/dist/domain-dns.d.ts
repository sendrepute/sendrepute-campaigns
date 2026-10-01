import { Resolver } from "node:dns/promises";
import type { ResolverOptions } from "node:dns";
import type { DnsVerifier } from "./domains-tracking.js";
type DomainResolver = Pick<Resolver, "resolve4" | "resolve6" | "resolveTxt">;
export type DomainResolverFactory = (options: ResolverOptions) => DomainResolver;
export declare function isAbsentDnsError(error: unknown): boolean;
/** One dedicated resolver for an entire attempt, using the system's DNS servers. */
export declare function createSystemDnsVerifier(createResolver?: DomainResolverFactory): DnsVerifier;
/** Compatibility for direct callers; no resolver is retained across calls. */
export declare const systemDnsVerifier: DnsVerifier;
export {};
//# sourceMappingURL=domain-dns.d.ts.map