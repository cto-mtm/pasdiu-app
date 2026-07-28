import type Stripe from "stripe";
import { logger } from "firebase-functions/v2";
import { PAID_PLANS } from "../plans.js";
import type { PaidPlanId } from "../plans.js";

export type BillingInterval = "month" | "year";

const PRICE_ENV_KEYS: Record<PaidPlanId, Record<BillingInterval, string>> = {
  studio: { month: "STRIPE_PRICE_STUDIO_MONTHLY", year: "STRIPE_PRICE_STUDIO_ANNUAL" },
  agency: { month: "STRIPE_PRICE_AGENCY_MONTHLY", year: "STRIPE_PRICE_AGENCY_ANNUAL" },
};

/**
 * Stripe Price `lookup_key` per plan + interval — the stable handle for "the
 * price we currently sell for this slot". A lookup key is unique per account
 * and survives product renames, price re-creation (raise the amount, create a
 * new price with `transfer_lookup_key: true`) and catalog restructuring, so
 * resolution never depends on guessing from product names.
 *
 * Set them once per Stripe account (see functions/stripe-setup.mjs).
 */
export const PRICE_LOOKUP_KEYS: Record<PaidPlanId, Record<BillingInterval, string>> = {
  studio: { month: "studio_monthly", year: "studio_annual" },
  agency: { month: "agency_monthly", year: "agency_annual" },
};

/** `studio_month` — the dynamic-cache key for a plan + interval slot. */
function slotKey(plan: PaidPlanId, interval: BillingInterval): string {
  return `${plan}_${interval}`;
}

/** Every lookup key we own, and the slot each one fills. */
const SLOT_BY_LOOKUP_KEY = new Map<string, string>(
  PAID_PLANS.flatMap((plan) =>
    (["month", "year"] as BillingInterval[]).map(
      (interval) => [PRICE_LOOKUP_KEYS[plan][interval], slotKey(plan, interval)] as const
    )
  )
);

const SLOT_COUNT = SLOT_BY_LOOKUP_KEY.size;

/** Web-app origin — Checkout/Portal redirects and invite-email links. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:5173";
}

/**
 * Origin for Stripe return URLs. An explicit APP_URL always wins; otherwise
 * follow the calling web app's own https Origin, so billing needs zero origin
 * config on any domain. Non-https origins (the Capacitor shells'
 * capacitor://localhost / http://localhost) fall back to appUrl() — Stripe
 * couldn't send the browser back to those anyway. Reflecting Origin is safe
 * here: it only decides where the CALLER's own browser lands after checkout.
 */
export function returnOrigin(req: { headers: { origin?: string } }): string {
  if (process.env.APP_URL) return appUrl();
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.startsWith("https://")) return origin;
  return appUrl();
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
 * Returns the Stripe price ID for a plan + interval, or "" when the catalog
 * has no price for that slot. Resolution order:
 *   1. STRIPE_PRICE_* env var (explicit pin — always wins)
 *   2. Stripe price `lookup_key` (see PRICE_LOOKUP_KEYS)
 *   3. product name/metadata heuristic (legacy fallback)
 */
export async function priceIdFor(plan: PaidPlanId, interval: BillingInterval): Promise<string> {
  const envVal = process.env[PRICE_ENV_KEYS[plan][interval]];
  if (envVal) return envVal;

  if (!billingEnabled()) return "";

  const slot = slotKey(plan, interval);
  if (!dynamicPriceCache || Date.now() - dynamicPriceCacheTime >= CACHE_TTL_MS) {
    await refreshPriceCache();
  }

  const priceId = dynamicPriceCache?.[slot] ?? "";
  if (!priceId) {
    logger.error("no Stripe price resolved for plan + interval", {
      plan,
      interval,
      lookupKey: PRICE_LOOKUP_KEYS[plan][interval],
      envKey: PRICE_ENV_KEYS[plan][interval],
    });
  }
  return priceId;
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
        dynamicPriceCache[slotKey(plan, "month")] === priceId ||
        dynamicPriceCache[slotKey(plan, "year")] === priceId
      ) {
        return plan;
      }
    }
  }

  // 3. Fallback: query the price directly — its lookup key, else its product.
  //    Reached for prices no longer in the catalog scan, e.g. a subscription
  //    still riding a price that has since been archived or superseded.
  try {
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const slot = price.lookup_key ? SLOT_BY_LOOKUP_KEY.get(price.lookup_key) : undefined;
    if (slot) {
      const plan = PAID_PLANS.find((p) => slot === slotKey(p, "month") || slot === slotKey(p, "year"));
      if (plan) return plan;
    }
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
    const newCache: Record<string, string> = {};

    // 1. Lookup keys — exact and unambiguous. A lookup key is unique per
    //    Stripe account, so this can never resolve to two candidate prices.
    const tagged = await stripe.prices.list({
      lookup_keys: [...SLOT_BY_LOOKUP_KEY.keys()],
      active: true,
      limit: 100,
    });
    for (const price of tagged.data) {
      const slot = price.lookup_key ? SLOT_BY_LOOKUP_KEY.get(price.lookup_key) : undefined;
      if (slot) newCache[slot] = price.id;
    }

    // 2. Legacy fallback for slots no lookup key filled: guess from the
    //    product name/metadata. Ambiguous by nature — a catalog that has ever
    //    been restructured holds several prices matching the same slot — so
    //    take the NEWEST (Stripe lists newest-first, hence first-wins) and skip
    //    prices whose product is archived, which Checkout rejects outright.
    if (Object.keys(newCache).length < SLOT_COUNT) {
      const all = await stripe.prices.list({ expand: ["data.product"], active: true, limit: 100 });
      for (const price of all.data) {
        const prod = price.product;
        if (typeof prod !== "object" || prod === null) continue;
        if ("deleted" in prod && prod.deleted) continue;
        if ("active" in prod && prod.active === false) continue;

        const name = ("name" in prod ? prod.name : "").toLowerCase();
        const metaPlan = ("metadata" in prod && prod.metadata?.plan ? prod.metadata.plan : "").toLowerCase();
        const planKey: PaidPlanId | null =
          metaPlan === "agency" || name.includes("agency") ? "agency" :
          metaPlan === "studio" || name.includes("studio") ? "studio" : null;

        // Only the price's own recurring interval decides month vs year. The
        // product name cannot: one product now carries BOTH intervals.
        const recurring = price.recurring?.interval;
        const intervalKey: BillingInterval | null =
          recurring === "year" ? "year" : recurring === "month" ? "month" : null;

        if (!planKey || !intervalKey) continue;
        const slot = slotKey(planKey, intervalKey);
        if (!newCache[slot]) newCache[slot] = price.id;
      }
    }

    if (Object.keys(newCache).length < SLOT_COUNT) {
      logger.warn("Stripe price catalog is incomplete", {
        resolved: newCache,
        expectedLookupKeys: [...SLOT_BY_LOOKUP_KEY.keys()],
      });
    }
    dynamicPriceCache = newCache;
    dynamicPriceCacheTime = Date.now();
  } catch (err) {
    // Leave dynamicPriceCacheTime stale so the next request retries rather
    // than serving an empty catalog for the whole TTL.
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
