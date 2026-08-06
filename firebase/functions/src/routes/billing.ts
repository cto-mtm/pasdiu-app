import express from "express";
import type { Request, RequestHandler } from "express";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { requireAuth } from "../helpers/auth.js";
import {
  ApiError,
  asyncHandler,
  userOf,
  emailOf,
} from "../helpers/apiErrors.js";
import { requireManagerAndGetOrg } from "../helpers/membership.js";
import {
  handleStripeEvent,
  limitsOf,
  PAID_PLAN_IDS,
} from "../helpers/stripeHandlers.js";
import {
  billingEnabled,
  getStripe,
  priceIdFor,
  returnOrigin,
} from "../helpers/stripe.js";
import type { BillingInterval } from "../helpers/stripe.js";
import { DISPLAY_PRICES } from "../plans.js";
import type { PaidPlanId } from "../plans.js";

const BILLING_INTERVALS: BillingInterval[] = ["month", "year"];

// ── POST /billing/webhook (Stripe signature, NOT requireAuth) ───────────────
export const billingWebhookHandler: RequestHandler = asyncHandler(async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!billingEnabled() || !secret) {
    throw new ApiError(503, "billing_disabled");
  }
  const signature = req.headers["stripe-signature"];
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (typeof signature !== "string" || !rawBody) {
    throw new ApiError(400, "invalid_signature");
  }
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    logger.warn("stripe webhook: signature verification failed", { err });
    throw new ApiError(400, "invalid_signature");
  }
  try {
    await handleStripeEvent(event);
  } catch (err) {
    logger.error("stripe webhook: handler failed (500 → Stripe retries)", { id: event.id, type: event.type, err });
    throw new ApiError(500, "handler_failed");
  }
  res.json({ received: true });
});

// ── /billing router (authenticated) ─────────────────────────────────────────
export const billingRouter = express.Router();
billingRouter.use(requireAuth);

// GET /billing/config
billingRouter.get("/config", (_req, res) => {
  res.json({
    enabled: billingEnabled(),
    plans: {
      studio: { ...limitsOf("studio"), ...DISPLAY_PRICES.studio },
      agency: { ...limitsOf("agency"), ...DISPLAY_PRICES.agency },
    },
  });
});

// POST /billing/checkout
billingRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : "";
    const plan = req.body?.plan as PaidPlanId;
    const interval = req.body?.interval as BillingInterval;
    if (!orgId || !PAID_PLAN_IDS.includes(plan) || !BILLING_INTERVALS.includes(interval)) {
      throw new ApiError(400, "invalid_body", "orgId, plan ('studio'|'agency') and interval ('month'|'year') are required");
    }
    if (!billingEnabled()) throw new ApiError(503, "billing_disabled");

    const db = getFirestore();
    const { ref: orgRef, snap: orgSnap } = await requireManagerAndGetOrg(db, orgId, user.uid);

    // Resolve the price BEFORE touching Stripe customers: an unresolved slot
    // used to reach Checkout as `price: ""` and surface as an opaque Stripe
    // error, after having already created a customer for a doomed session.
    const priceId = await priceIdFor(plan, interval);
    if (!priceId) throw new ApiError(503, "price_unavailable");

    const stripe = getStripe();
    let customerId = orgSnap.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
      const customer = await stripe.customers.create({
        name: orgSnap.get("name"),
        email: emailOf(user),
        metadata: { orgId },
      });
      customerId = customer.id;
      await orgRef.update({ stripeCustomerId: customerId });
    }

    // Flat per-workspace pricing (BUSINESS_MODEL §2): always exactly one unit
    // of the plan. Seats are a cap enforced on invite accept, never a billed
    // quantity — sending the seat count would multiply the flat price by the
    // size of the team, which is the entire thing this model removes.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { orgId, plan } },
      metadata: { orgId, plan },
      success_url: `${returnOrigin(req)}/settings?billing=success`,
      cancel_url: `${returnOrigin(req)}/settings?billing=cancelled`,
    });
    res.json({ url: session.url });
  })
);

// POST /billing/portal
billingRouter.post(
  "/portal",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : "";
    if (!orgId) throw new ApiError(400, "orgId_required");
    if (!billingEnabled()) throw new ApiError(503, "billing_disabled");

    const db = getFirestore();
    const { snap: orgSnap } = await requireManagerAndGetOrg(db, orgId, user.uid);
    const customerId = orgSnap.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
      throw new ApiError(409, "no_customer");
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${returnOrigin(req)}/settings`,
    });
    res.json({ url: session.url });
  })
);
