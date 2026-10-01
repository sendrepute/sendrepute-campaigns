import { Resolver } from "node:dns/promises";
export function isAbsentDnsError(error) {
    return !!error && typeof error === "object" && "code" in error &&
        (error.code === "ENODATA" || error.code === "ENOTFOUND");
}
/** One dedicated resolver for an entire attempt, using the system's DNS servers. */
export function createSystemDnsVerifier(createResolver = options => new Resolver(options)) {
    // Do not setServers: keep the operator's system configuration, with no
    // third-party fallback. Bound each query's timeout and retry count.
    const resolver = createResolver({ timeout: 3000, tries: 2 });
    return {
        resolveTxt: hostname => resolver.resolveTxt(hostname),
        async resolveAddresses(hostname) {
            const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
            const addresses = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
            // Either address family may suffice, but never disguise resolver outages
            // as missing records when neither family yielded an address.
            if (!addresses.length) {
                const failure = results.find(result => result.status === "rejected" && !isAbsentDnsError(result.reason));
                if (failure?.status === "rejected")
                    throw failure.reason;
            }
            return addresses;
        },
    };
}
/** Compatibility for direct callers; no resolver is retained across calls. */
export const systemDnsVerifier = {
    resolveTxt: hostname => createSystemDnsVerifier().resolveTxt(hostname),
    resolveAddresses: hostname => createSystemDnsVerifier().resolveAddresses(hostname),
};
//# sourceMappingURL=domain-dns.js.map