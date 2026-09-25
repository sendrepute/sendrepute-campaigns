/** Public subscription endpoints must not reveal delivery, database or queue internals. */
export declare function publicSubscriptionFailure(status: number, path: string): {
    error: string;
    code: string;
};
//# sourceMappingURL=public-subscription-errors.d.ts.map