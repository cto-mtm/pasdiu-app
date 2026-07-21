import type Stripe from "stripe";
import { logger } from "firebase-functions/v2";
import { PAID_PLANS } from "../plans.js";
import type { PaidPlanId } from "../plans.js";

export type BillingInterval = "month" | "year";

const PRICE_ENV_KEYS: Record<PaidPlanId, Record<BillingInterval, string>> = {
  studio: { month: "STRIPE_PRICE_STUDIO_MONTHLY", year: "STRIPE_PRICE_STUDIO_ANNUAL" },
  agency: { month: "STRIPE_PRICE_AGENCY_MONTHLY", year: "STRIPE_PRICE_AGENCY_ANNUAL" },
};

/** Web-app origin — Checkout/Portal redirects and invite-email links. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:5173";
}

/** Cache for dynamically fetched Stripe price IDs */
let dynamicPriceCache: Record<string, string> | null = null;
let dynamicPriceCacheTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes cache

/** True when the secret key is configured. */
export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Returns Stripe price ID for a plan + interval.
 * Checks env vars first. If not set, dynamically queries active Stripe products.
 */
export async function priceIdFor(plan: PaidPlanId, interval: BillingInterval): Promise<string> {
  const envVal = process.env[PRICE_ENV_KEYS[plan][interval]];
  if (envVal) return envVal;

  if (!billingEnabled()) return "";

  const cacheKey = `${plan}_${interval}`;
  if (dynamicPriceCache && Date.now() - dynamicPriceCacheTime < CACHE_TTL_MS) {
    return dynamicPriceCache[cacheKey] ?? "";
  }

  await refreshPriceCache();
  return dynamicPriceCache?.[cacheKey] ?? "";
}

/** Reverse lookup: Stripe price ID → plan (null when it maps to no plan). */
export async function planForPriceId(priceId: string): Promise<PaidPlanId | null> {
  if (!priceId) return null;

  // 1. Check static env vars
  for (const plan of PAID_PLANS) {
    if (
      process.env[PRICE_ENV_KEYS[plan].month] === priceId ||
      process.env[PRICE_ENV_KEYS[plan].year] === priceId
    ) {
      return plan;
    }
  }

  // 2. Check dynamic cache
  if (!dynamicPriceCache || Date.now() - dynamicPriceCacheTime >= CACHE_TTL_MS) {
    await refreshPriceCache();
  }

  if (dynamicPriceCache) {
    for (const plan of PAID_PLANS) {
      if (
        dynamicPriceCache[`${plan}_month`] === priceId ||
        dynamicPriceCache[`${plan}_year`] === priceId
      ) {
        return plan;
      }
    }
  }

  // 3. Fallback: query price directly from Stripe API
  try {
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const prod = price.product;
    if (typeof prod === "object" && prod !== null) {
      const name = ("name" in prod ? prod.name : "").toLowerCase();
      const metaPlan = ("metadata" in prod && prod.metadata?.plan ? prod.metadata.plan : "").toLowerCase();
      if (metaPlan === "agency" || name.includes("agency")) return "agency";
      if (metaPlan === "studio" || name.includes("studio")) return "studio";
    }
  } catch (err) {
    logger.warn("planForPriceId lookup failed", { priceId, err });
  }

  return null;
}

async function refreshPriceCache(): Promise<void> {
  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({ expand: ["data.product"], active: true, limit: 100 });
    const newCache: Record<string, string> = {};

    for (const price of prices.data) {
      const prod = price.product;
      if (typeof prod === "object" && prod !== null) {
        const name = ("name" in prod ? prod.name : "").toLowerCase();
        const metaPlan = ("metadata" in prod && prod.metadata?.plan ? prod.metadata.plan : "").toLowerCase();
        
        const planKey: PaidPlanId | null =
          metaPlan === "agency" || name.includes("agency") ? "agency" :
          metaPlan === "studio" || name.includes("studio") ? "studio" : null;

        const isYearly = price.recurring?.interval === "year" || name.includes("year") || name.includes("annual");
        const isMonthly = price.recurring?.interval === "month" || name.includes("month") || name.includes("montly");
        
        const intervalKey: BillingInterval | null =
          isYearly ? "year" :
          isMonthly ? "month" : null;

        if (planKey && intervalKey) {
          newCache[`${planKey}_${intervalKey}`] = price.id;
        }
      }
    }
    dynamicPriceCache = newCache;
    dynamicPriceCacheTime = Date.now();
  } catch (err) {
    logger.warn("refreshPriceCache failed", err);
    dynamicPriceCache = {};
  }
}

let client: Stripe | null = null;

/** Lazy singleton Stripe client. Throws when STRIPE_SECRET_KEY is not set. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — billing is disabled");
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("stripe") as typeof Stripe & { default?: typeof Stripe };
    const StripeCtor = (mod.default ?? mod) as typeof Stripe;
    client = new StripeCtor(key);
  }
  return client;
}
