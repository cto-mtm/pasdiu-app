// /billing — config, checkout/portal gates, and the Stripe webhook.
//
// Stripe is NOT mocked. We test exactly what is testable without network:
//  - billing disabled (no env)  → config { enabled: false } + 503s
//  - configured with fake keys  → the request gates that fire BEFORE any
//    Stripe API call (400 body, 403 non-manager, 409 no_customer)
//  - webhook flows whose handlers are payload + Firestore only
//    (customer.subscription.updated / .deleted, invoice.payment_failed),
//    signed OFFLINE with stripe.webhooks.generateTestHeaderString.
//
// checkout.session.completed is deliberately NOT tested here: its handler
// calls stripe.subscriptions.retrieve (a network call). That flow is covered
// by the manual Stripe-CLI walkthrough in README.md ("Billing (Stripe)").
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  clearFirestore,
  makeUserToken,
  get,
  post,
  getAnon,
  postWebhook,
  seedOrg,
  seedMember,
  seedUsage,
  stripeEnv,
  stripeSignature,
} from "./helpers.js";
import { PRICE_LOOKUP_KEYS, priceIdFor } from "../src/helpers/stripe.js";
// Limits are asserted through PLAN_LIMITS, never as literals: the webhook
// writes whatever the table says, so hardcoding the numbers here only creates
// a second source of truth that goes stale the next time pricing changes.
import { PLAN_LIMITS } from "../src/plans.js";

const FAKE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_offline_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_studio_m",
  STRIPE_PRICE_STUDIO_ANNUAL: "price_studio_y",
  STRIPE_PRICE_AGENCY_MONTHLY: "price_agency_m",
  STRIPE_PRICE_AGENCY_ANNUAL: "price_agency_y",
} as const;

beforeEach(async () => {
  await clearFirestore();
});

// ── Price resolution (offline paths only — no Stripe catalog call) ─────────

describe("price resolution", () => {
  it("maps every plan + interval slot to a distinct lookup key", () => {
    // These four strings are the contract with the Stripe catalog: they must
    // match the keys assigned by functions/stripe-setup.mjs, and a duplicate
    // would silently point two plans at one price.
    expect(PRICE_LOOKUP_KEYS).toEqual({
      studio: { month: "studio_monthly", year: "studio_annual" },
      agency: { month: "agency_monthly", year: "agency_annual" },
    });
    const keys = Object.values(PRICE_LOOKUP_KEYS).flatMap((byInterval) => Object.values(byInterval));
    expect(new Set(keys).size).toBe(4);
  });

  it("prefers an explicitly pinned STRIPE_PRICE_* env var over any catalog lookup", async () => {
    const restore = stripeEnv({ ...FAKE_ENV });
    try {
      // Env hit returns before Stripe is ever contacted — so this stays offline.
      await expect(priceIdFor("studio", "month")).resolves.toBe("price_studio_m");
      await expect(priceIdFor("agency", "year")).resolves.toBe("price_agency_y");
    } finally {
      restore();
    }
  });

  it("resolves to an empty price id when billing is disabled", async () => {
    const restore = stripeEnv({});
    try {
      await expect(priceIdFor("studio", "month")).resolves.toBe("");
    } finally {
      restore();
    }
  });
});

// ── Billing disabled (no Stripe env — the default in this suite) ───────────

describe("billing disabled (no Stripe env)", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = stripeEnv({}); // explicitly unset every Stripe key
  });
  afterAll(() => restore());

  it("GET /billing/config rejects requests without a token (401)", async () => {
    const res = await getAnon("/billing/config");
    expect(res.status).toBe(401);
  });

  it("GET /billing/config reports enabled: false with the display prices", async () => {
    const token = await makeUserToken({ uid: "u-bill-config", email: "bill-config@test.dev" });
    const res = await get("/billing/config", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      plans: {
        studio: { seatLimit: 20, clientLimit: -1, taskLimit: 10000, priceMonthly: 49, priceAnnualTotal: 490 },
        agency: { seatLimit: -1, clientLimit: -1, taskLimit: -1, priceMonthly: 149, priceAnnualTotal: 1490 },
      },
    });
  });

  it("POST /billing/checkout 503s for everyone — the billing gate fires before the role gate", async () => {
    // Code order in the handler: 400 body → 503 billing_disabled → 403
    // managers-only. So with billing off, even a non-member gets 503.
    await seedOrg("org-bd");
    await seedMember("org-bd", "u-bd-admin", "admin");
    const admin = await makeUserToken({ uid: "u-bd-admin", email: "bd-admin@test.dev" });
    const outsider = await makeUserToken({ uid: "u-bd-outsider", email: "bd-outsider@test.dev" });

    const body = { orgId: "org-bd", plan: "studio", interval: "month" };
    for (const token of [admin, outsider]) {
      const res = await post("/billing/checkout", token, body);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("billing_disabled");
    }
  });

  it("POST /billing/portal 503s billing_disabled", async () => {
    const token = await makeUserToken({ uid: "u-bd-portal", email: "bd-portal@test.dev" });
    const res = await post("/billing/portal", token, { orgId: "org-bd" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("billing_disabled");
  });

  it("POST /billing/webhook 503s when unconfigured", async () => {
    const res = await postWebhook(JSON.stringify({ id: "evt_disabled", type: "noop" }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("billing_disabled");
  });
});

// ── Billing configured (fake keys) — gates that fire before any Stripe call ─

describe("billing configured (fake keys): request gates", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = stripeEnv({ ...FAKE_ENV });
  });
  afterAll(() => restore());

  it("GET /billing/config reports enabled: true", async () => {
    const token = await makeUserToken({ uid: "u-bc-config", email: "bc-config@test.dev" });
    const res = await get("/billing/config", token);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it("POST /billing/checkout 400s on an invalid body", async () => {
    const token = await makeUserToken({ uid: "u-bc-badbody", email: "bc-badbody@test.dev" });
    const res = await post("/billing/checkout", token, { orgId: "org-bc", plan: "studio" }); // no interval
    expect(res.status).toBe(400);
  });

  it("POST /billing/checkout 403s for a non-manager (before any Stripe call)", async () => {
    await seedOrg("org-bc");
    await seedUsage("org-bc");
    await seedMember("org-bc", "u-bc-contractor", "contractor");
    const token = await makeUserToken({ uid: "u-bc-contractor", email: "bc-contractor@test.dev" });

    const res = await post("/billing/checkout", token, {
      orgId: "org-bc",
      plan: "studio",
      interval: "month",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Managers only");
  });

  it("POST /billing/portal 409s no_customer when the org has no Stripe customer", async () => {
    await seedOrg("org-bc2"); // no stripeCustomerId on the doc
    await seedMember("org-bc2", "u-bc-mgr", "admin");
    const token = await makeUserToken({ uid: "u-bc-mgr", email: "bc-mgr@test.dev" });

    const res = await post("/billing/portal", token, { orgId: "org-bc2" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_customer");
  });
});

// ── Webhook: offline-signed events whose handlers are Firestore-only ────────

describe("POST /billing/webhook (offline-signed events)", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = stripeEnv({ ...FAKE_ENV });
  });
  afterAll(() => restore());

  const PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 86400;

  /** Minimal-but-realistic event JSON — only the fields the handlers read. */
  function subscriptionEvent(opts: {
    eventId: string;
    type: "customer.subscription.updated" | "customer.subscription.deleted";
    subscriptionId: string;
    status: string;
    orgId?: string;
    priceId?: string;
  }): string {
    return JSON.stringify({
      id: opts.eventId,
      object: "event",
      type: opts.type,
      data: {
        object: {
          id: opts.subscriptionId,
          object: "subscription",
          status: opts.status,
          metadata: opts.orgId ? { orgId: opts.orgId } : {},
          items: {
            data: [
              {
                id: "si_test",
                price: { id: opts.priceId ?? FAKE_ENV.STRIPE_PRICE_STUDIO_MONTHLY },
                current_period_end: PERIOD_END,
              },
            ],
          },
        },
      },
    });
  }

  function invoiceFailedEvent(eventId: string, customerId: string): string {
    return JSON.stringify({
      id: eventId,
      object: "event",
      type: "invoice.payment_failed",
      data: { object: { object: "invoice", customer: customerId } },
    });
  }

  /** Sign with the configured secret and POST the exact payload bytes. */
  const send = (payload: string) =>
    postWebhook(payload, stripeSignature(payload, FAKE_ENV.STRIPE_WEBHOOK_SECRET));

  it("400s invalid_signature on a missing or bogus signature", async () => {
    const payload = JSON.stringify({ id: "evt_sig", type: "customer.subscription.updated" });
    const missing = await postWebhook(payload);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_signature");

    const bogus = await postWebhook(payload, "t=12345,v1=deadbeef");
    expect(bogus.status).toBe(400);
    expect(bogus.body.error).toBe("invalid_signature");
  });

  it("customer.subscription.updated (metadata.orgId path) updates plan, limits, status", async () => {
    await seedOrg("org-wh1");

    const res = await send(
      subscriptionEvent({
        eventId: "evt_wh1",
        type: "customer.subscription.updated",
        subscriptionId: "sub_wh1",
        status: "active",
        orgId: "org-wh1",
        priceId: FAKE_ENV.STRIPE_PRICE_STUDIO_MONTHLY,
      })
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const db = getFirestore();
    const org = await db.doc("orgs/org-wh1").get();
    expect(org.get("plan")).toBe("studio");
    expect(org.get("seatLimit")).toBe(PLAN_LIMITS.studio.seatLimit);
    expect(org.get("clientLimit")).toBe(PLAN_LIMITS.studio.clientLimit);
    expect(org.get("taskLimit")).toBe(PLAN_LIMITS.studio.taskLimit);
    expect(org.get("subscriptionStatus")).toBe("active");
    expect(org.get("stripeSubscriptionId")).toBe("sub_wh1");
    const end = org.get("currentPeriodEnd") as Timestamp;
    expect(end.toMillis()).toBe(PERIOD_END * 1000);

    // Idempotency marker written in the same transaction.
    const marker = await db.doc("billingEvents/evt_wh1").get();
    expect(marker.exists).toBe(true);
    expect(marker.get("orgId")).toBe("org-wh1");
    expect(marker.get("type")).toBe("customer.subscription.updated");
  });

  it("customer.subscription.updated falls back to a stripeSubscriptionId lookup when metadata has no orgId", async () => {
    await seedOrg("org-wh2", { stripeSubscriptionId: "sub_wh2" });

    const res = await send(
      subscriptionEvent({
        eventId: "evt_wh2",
        type: "customer.subscription.updated",
        subscriptionId: "sub_wh2",
        status: "active",
        priceId: FAKE_ENV.STRIPE_PRICE_AGENCY_ANNUAL,
      })
    );
    expect(res.status).toBe(200);

    const org = await getFirestore().doc("orgs/org-wh2").get();
    expect(org.get("plan")).toBe("agency");
    expect(org.get("seatLimit")).toBe(PLAN_LIMITS.agency.seatLimit);
    expect(org.get("clientLimit")).toBe(PLAN_LIMITS.agency.clientLimit);
    expect(org.get("taskLimit")).toBe(PLAN_LIMITS.agency.taskLimit);
    expect(org.get("subscriptionStatus")).toBe("active");
  });

  it("an unknown price id updates the status but never corrupts the plan", async () => {
    await seedOrg("org-wh3"); // free plan, free limits

    const res = await send(
      subscriptionEvent({
        eventId: "evt_wh3",
        type: "customer.subscription.updated",
        subscriptionId: "sub_wh3",
        status: "active",
        orgId: "org-wh3",
        priceId: "price_unknown_to_us",
      })
    );
    expect(res.status).toBe(200);

    const org = await getFirestore().doc("orgs/org-wh3").get();
    expect(org.get("plan")).toBe("free"); // untouched
    expect(org.get("seatLimit")).toBe(PLAN_LIMITS.free.seatLimit); // free limits untouched
    expect(org.get("subscriptionStatus")).toBe("active"); // status still tracked
  });

  it("replaying the same event id is a no-op (billingEvents idempotency)", async () => {
    await seedOrg("org-wh4");
    const payload = subscriptionEvent({
      eventId: "evt_wh4",
      type: "customer.subscription.updated",
      subscriptionId: "sub_wh4",
      status: "active",
      orgId: "org-wh4",
      priceId: FAKE_ENV.STRIPE_PRICE_STUDIO_MONTHLY,
    });

    const first = await send(payload);
    expect(first.status).toBe(200);
    const db = getFirestore();
    expect((await db.doc("orgs/org-wh4").get()).get("plan")).toBe("studio");

    // Simulate later drift, then replay the SAME event: the marker must win.
    await db.doc("orgs/org-wh4").update({ plan: "free", seatLimit: 2 });
    const replay = await send(payload);
    expect(replay.status).toBe(200);

    const org = await db.doc("orgs/org-wh4").get();
    expect(org.get("plan")).toBe("free"); // replay wrote nothing
    expect(org.get("seatLimit")).toBe(2);
  });

  it("customer.subscription.deleted downgrades to free, cancels, and removes the subscription id", async () => {
    await seedOrg("org-wh5", {
      plan: "studio",
      seatLimit: PLAN_LIMITS.studio.seatLimit,
      clientLimit: PLAN_LIMITS.studio.clientLimit,
      taskLimit: PLAN_LIMITS.studio.taskLimit,
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_wh5",
    });

    const res = await send(
      subscriptionEvent({
        eventId: "evt_wh5",
        type: "customer.subscription.deleted",
        subscriptionId: "sub_wh5",
        status: "canceled",
        orgId: "org-wh5",
      })
    );
    expect(res.status).toBe(200);

    const org = await getFirestore().doc("orgs/org-wh5").get();
    expect(org.get("plan")).toBe("free");
    expect(org.get("seatLimit")).toBe(PLAN_LIMITS.free.seatLimit);
    expect(org.get("clientLimit")).toBe(PLAN_LIMITS.free.clientLimit);
    expect(org.get("taskLimit")).toBe(PLAN_LIMITS.free.taskLimit);
    expect(org.get("subscriptionStatus")).toBe("canceled");
    expect(org.get("stripeSubscriptionId")).toBeUndefined(); // FieldValue.delete()
  });

  it("invoice.payment_failed marks the org past_due via its stripeCustomerId", async () => {
    await seedOrg("org-wh6", {
      plan: "studio",
      subscriptionStatus: "active",
      stripeCustomerId: "cus_wh6",
    });

    const res = await send(invoiceFailedEvent("evt_wh6", "cus_wh6"));
    expect(res.status).toBe(200);

    const org = await getFirestore().doc("orgs/org-wh6").get();
    expect(org.get("subscriptionStatus")).toBe("past_due");
    expect(org.get("plan")).toBe("studio"); // plan untouched by a failed invoice
  });

  it("500s handler_failed when the org write fails, so Stripe retries", async () => {
    // Constructible offline: metadata points at an org doc that does not
    // exist, so the transaction's update() aborts — and because the
    // idempotency marker is written in the SAME transaction, no marker is
    // left behind (a retry gets a clean slate).
    const res = await send(
      subscriptionEvent({
        eventId: "evt_wh500",
        type: "customer.subscription.updated",
        subscriptionId: "sub_wh500",
        status: "active",
        orgId: "org-wh-missing",
      })
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("handler_failed");

    const marker = await getFirestore().doc("billingEvents/evt_wh500").get();
    expect(marker.exists).toBe(false);
  });

  it("acknowledges unhandled event types (200, no retry)", async () => {
    const payload = JSON.stringify({
      id: "evt_wh_other",
      object: "event",
      type: "customer.created",
      data: { object: { id: "cus_x", object: "customer" } },
    });
    const res = await send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
