export declare const PLAN_LIMITS: {
    readonly free: {
        readonly seatLimit: 2;
        readonly clientLimit: 3;
        readonly taskLimit: 500;
    };
    readonly studio: {
        readonly seatLimit: 15;
        readonly clientLimit: 25;
        readonly taskLimit: 10000;
    };
    readonly agency: {
        readonly seatLimit: 50;
        readonly clientLimit: -1;
        readonly taskLimit: -1;
    };
};
export type PlanId = keyof typeof PLAN_LIMITS;
export type PlanLimits = (typeof PLAN_LIMITS)[PlanId];
/** Plans purchasable through Stripe (everything except free). */
export type PaidPlanId = Exclude<PlanId, "free">;
export declare const PAID_PLANS: readonly PaidPlanId[];
export declare const DISPLAY_PRICES: {
    readonly studio: {
        readonly priceMonthly: 12;
        readonly priceAnnual: 10;
    };
    readonly agency: {
        readonly priceMonthly: 25;
        readonly priceAnnual: 21;
    };
};
