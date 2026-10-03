import { Resolver } from "node:dns/promises";
export type HygieneCheck = {
    status: "passed" | "risky" | "invalid" | "unknown";
    reasons: string[];
    checkedAt: string;
};
export declare function emailDomain(address: string): string;
export declare function checkEmailBasic(address: unknown, now?: Date, disposableDomains?: ReadonlySet<string>): HygieneCheck;
export type MailDnsResolver = Pick<Resolver, "resolveMx" | "resolve4" | "resolve6">;
export declare function createMailDnsResolver(): MailDnsResolver;
/** Domain configuration only. No SMTP connections, mail sending or mailbox claims. */
export declare function checkMailDomain(domain: string, resolver?: MailDnsResolver): Promise<HygieneCheck>;
export declare function combineHygieneChecks(basic: HygieneCheck, domain?: HygieneCheck, duplicate?: boolean): HygieneCheck;
//# sourceMappingURL=email-hygiene.d.ts.map