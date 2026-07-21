"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appUrl = appUrl;
exports.priceIdFor = priceIdFor;
exports.planForPriceId = planForPriceId;
exports.billingEnabled = billingEnabled;
exports.getStripe = getStripe;
const plans_js_1 = require("../plans.js");
const PRICE_ENV_KEYS = {
    studio: { month: "STRIPE_PRICE_STUDIO_MONTHLY", year: "STRIPE_PRICE_STUDIO_ANNUAL" },
    agency: { month: "STRIPE_PRICE_AGENCY_MONTHLY", year: "STRIPE_PRICE_AGENCY_ANNUAL" },
};
/** Web-app origin — Checkout/Portal redirects and invite-email links. */
function appUrl() {
    return process.env.APP_URL || "http://localhost:5173";
}
/** Stripe price ID for a plan + interval, or "" when the env var is unset. */
function priceIdFor(plan, interval) {
    return process.env[PRICE_ENV_KEYS[plan][interval]] ?? "";
}
/** Reverse lookup: Stripe price ID → plan (null when it maps to no plan). */
function planForPriceId(priceId) {
    if (!priceId)
        return null;
    for (const plan of plans_js_1.PAID_PLANS) {
        if (priceIdFor(plan, "month") === priceId || priceIdFor(plan, "year") === priceId)
            return plan;
    }
    return null;
}
/** True when the secret key and all four price IDs are configured. */
function billingEnabled() {
    return (Boolean(process.env.STRIPE_SECRET_KEY) &&
        plans_js_1.PAID_PLANS.every((plan) => priceIdFor(plan, "month") && priceIdFor(plan, "year")));
}
let client = null;
/** Lazy singleton Stripe client. Throws when STRIPE_SECRET_KEY is not set. */
function getStripe() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key)
        throw new Error("STRIPE_SECRET_KEY is not set — billing is disabled");
    if (!client) {
        // Deferred require: keeps this module loadable without the package.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("stripe");
        const StripeCtor = (mod.default ?? mod);
        client = new StripeCtor(key);
    }
    return client;
}
