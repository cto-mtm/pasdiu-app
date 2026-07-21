import type Stripe from "stripe";
import type { PaidPlanId } from "../plans.js";
export type BillingInterval = "month" | "year";
/** Web-app origin — Checkout/Portal redirects and invite-email links. */
export declare function appUrl(): string;
/** Stripe price ID for a plan + interval, or "" when the env var is unset. */
export declare function priceIdFor(plan: PaidPlanId, interval: BillingInterval): string;
/** Reverse lookup: Stripe price ID → plan (null when it maps to no plan). */
export declare function planForPriceId(priceId: string): PaidPlanId | null;
/** True when the secret key and all four price IDs are configured. */
export declare function billingEnabled(): boolean;
/** Lazy singleton Stripe client. Throws when STRIPE_SECRET_KEY is not set. */
export declare function getStripe(): Stripe;
