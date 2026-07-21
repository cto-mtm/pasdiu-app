"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPLAY_PRICES = exports.PAID_PLANS = exports.PLAN_LIMITS = void 0;
// Single source of truth for plan entitlements. Org docs are stamped from this
// map at creation, and the Stripe webhook (api.ts) imports it when writing
// org billing blocks — keep this module dependency-free.
// -1 means unlimited.
exports.PLAN_LIMITS = {
    free: { seatLimit: 2, clientLimit: 3, taskLimit: 500 },
    studio: { seatLimit: 15, clientLimit: 25, taskLimit: 10000 },
    agency: { seatLimit: 50, clientLimit: -1, taskLimit: -1 },
};
exports.PAID_PLANS = ["studio", "agency"];
// Display-only USD per-seat/month numbers for the pricing UI (annual is the
// per-seat/month rate when billed annually). The amounts Stripe actually
// charges live on the Stripe Prices — keep both in sync by hand.
exports.DISPLAY_PRICES = {
    studio: { priceMonthly: 12, priceAnnual: 10 },
    agency: { priceMonthly: 25, priceAnnual: 21 },
};
