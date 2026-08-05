#!/usr/bin/env node
// grant-plan-prod.mjs — Grant a paid plan to a production org WITHOUT going
// through Stripe Checkout.
//
// This creates a Stripe subscription directly (or optionally skips Stripe and
// only writes Firestore) so the org immediately gets the paid plan's limits.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_… GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node grant-plan-prod.mjs <email> [plan] [--no-stripe] [--interval month|year]
//
// Examples:
//   # Grant studio plan via Stripe (creates a $0 subscription)
//   node grant-plan-prod.mjs client@example.com studio
//
//   # Grant agency plan, annual interval
//   node grant-plan-prod.mjs client@example.com agency --interval year
//
//   # Skip Stripe entirely — only write Firestore (use for comped accounts)
//   node grant-plan-prod.mjs client@example.com agency --no-stripe
//
//   # Downgrade back to free (always Firestore-only, cancels active sub)
//   node grant-plan-prod.mjs client@example.com free
//
// Requirements:
//   - GOOGLE_APPLICATION_CREDENTIALS or GCLOUD_PROJECT + ADC for Firestore access
//   - STRIPE_SECRET_KEY for Stripe operations (sk_live_… or sk_test_…)
//   - Lookup keys assigned (run stripe-setup.mjs first to verify)
//
// What it does (with Stripe):
//   1. Looks up user by email in Firebase Auth
//   2. Finds their admin org(s)
//   3. Creates or reuses a Stripe customer for the org
//   4. Creates a subscription with a free trial lasting the full interval
//   5. Writes the billing fields to the org doc (same as the webhook would)
//
// What it does (--no-stripe):
//   1–2 same as above
//   3. Writes plan + limits directly to the org doc with subscriptionStatus "comped"

import admin from "firebase-admin";
import Stripe from "stripe";

// ─── Plan limits (mirrors @pasdiu/shared) ────────────────────────────────────
const PLAN_LIMITS = {
  free:   { seatLimit: 3,  clientLimit: 3,  taskLimit: 500,   deliverableLimit: 50 },
  studio: { seatLimit: 20, clientLimit: -1, taskLimit: 10000, deliverableLimit: 2000 },
  agency: { seatLimit: -1, clientLimit: -1, taskLimit: -1,    deliverableLimit: -1 },
};

const LOOKUP_KEYS = {
  studio: { month: "studio_monthly", year: "studio_annual" },
  agency: { month: "agency_monthly", year: "agency_annual" },
};

const VALID_PLANS = Object.keys(PLAN_LIMITS);

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith("--"));
const flags = args.filter(a => a.startsWith("--"));

const email = positional[0];
const plan = positional[1] || "studio";
const noStripe = flags.includes("--no-stripe");
const intervalIdx = args.indexOf("--interval");
const interval = intervalIdx !== -1 ? args[intervalIdx + 1] : "month";

if (!email) {
  console.error("Usage: node grant-plan-prod.mjs <email> [plan] [--no-stripe] [--interval month|year]");
  console.error(`  Plans: ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}
if (!VALID_PLANS.includes(plan)) {
  console.error(`Invalid plan "${plan}". Must be one of: ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}
if (!["month", "year"].includes(interval)) {
  console.error(`Invalid interval "${interval}". Must be "month" or "year".`);
  process.exit(1);
}

// ─── Firebase + Stripe init ──────────────────────────────────────────────────
const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
if (!projectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Set GCLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS for production Firestore access.");
  process.exit(1);
}
admin.initializeApp({ projectId: projectId || undefined });
const db = admin.firestore();
const auth = admin.auth();

const stripeKey = process.env.STRIPE_SECRET_KEY;
let stripe;
if (stripeKey && !noStripe && plan !== "free") {
  stripe = new Stripe(stripeKey);
  const mode = stripeKey.startsWith("sk_live") ? "LIVE" : "test";
  console.log(`Stripe: ${mode} mode\n`);
} else if (plan === "free") {
  if (stripeKey) stripe = new Stripe(stripeKey);
  console.log("Downgrading to free plan.\n");
} else if (noStripe) {
  console.log("--no-stripe: will write Firestore only (comped account).\n");
} else {
  console.error("STRIPE_SECRET_KEY required for paid plan grants (or use --no-stripe to comp).");
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Look up user
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`User: ${user.displayName || user.uid} (${user.email})`);

  // 2. Find admin orgs
  const memberSnaps = await db.collectionGroup("members")
    .where("uid", "==", user.uid)
    .get();

  if (memberSnaps.empty) {
    console.error(`User ${email} is not a member of any org.`);
    process.exit(1);
  }

  const adminOrgs = [];
  const allOrgs = [];
  for (const doc of memberSnaps.docs) {
    const data = doc.data();
    const orgId = doc.ref.parent.parent.id;
    allOrgs.push(orgId);
    if (data.role === "admin") adminOrgs.push(orgId);
  }

  const targetOrgIds = adminOrgs.length > 0 ? adminOrgs : allOrgs;
  console.log(`Target org(s): ${targetOrgIds.join(", ")}\n`);

  // 3. Apply plan
  const limits = PLAN_LIMITS[plan];

  for (const orgId of targetOrgIds) {
    const orgRef = db.doc(`orgs/${orgId}`);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      console.error(`  ✗ Org ${orgId} not found in Firestore — skipping.`);
      continue;
    }
    const orgData = orgSnap.data();
    const orgName = orgData.name || orgId;
    const currentPlan = orgData.plan || "unknown";

    console.log(`─── ${orgName} (${orgId}) ───`);
    console.log(`  Current plan: ${currentPlan}`);

    // ── FREE (downgrade) ──────────────────────────────────────────────────
    if (plan === "free") {
      // Cancel Stripe subscription if one exists
      if (stripe && orgData.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(orgData.stripeSubscriptionId);
          console.log(`  Cancelled Stripe subscription: ${orgData.stripeSubscriptionId}`);
        } catch (err) {
          console.warn(`  Warning: could not cancel subscription: ${err.message}`);
        }
      }
      await orgRef.update({
        plan: "free",
        ...limits,
        subscriptionStatus: "canceled",
      });
      console.log(`  ✓ Downgraded to free.\n`);
      continue;
    }

    // ── PAID (--no-stripe: Firestore only) ────────────────────────────────
    if (noStripe) {
      await orgRef.update({
        plan,
        ...limits,
        subscriptionStatus: "comped",
      });
      console.log(`  ✓ Granted ${plan} (comped, no Stripe subscription).\n`);
      continue;
    }

    // ── PAID (with Stripe: create a free subscription) ────────────────────
    // Ensure the org has a Stripe customer
    let customerId = orgData.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: orgName,
        email: user.email,
        metadata: { orgId },
      });
      customerId = customer.id;
      await orgRef.update({ stripeCustomerId: customerId });
      console.log(`  Created Stripe customer: ${customerId}`);
    } else {
      console.log(`  Existing Stripe customer: ${customerId}`);
    }

    // Cancel existing subscription if switching plans
    if (orgData.stripeSubscriptionId) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(orgData.stripeSubscriptionId);
        if (existingSub.status !== "canceled") {
          await stripe.subscriptions.cancel(orgData.stripeSubscriptionId);
          console.log(`  Cancelled previous subscription: ${orgData.stripeSubscriptionId}`);
        }
      } catch (err) {
        console.warn(`  Warning: could not cancel existing sub: ${err.message}`);
      }
    }

    // Resolve price via lookup key
    const lookupKey = LOOKUP_KEYS[plan][interval];
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (!prices.data.length) {
      console.error(`  ✗ No price found for lookup key "${lookupKey}". Run stripe-setup.mjs to verify.`);
      continue;
    }
    const priceId = prices.data[0].id;
    console.log(`  Price: ${priceId} (${lookupKey})`);

    // Create a subscription with a long trial (no charge for the trial period).
    // Using trial_end instead of a coupon because Stripe's flexible billing
    // mode doesn't support coupons on subscriptions.
    const trialDays = interval === "year" ? 365 : 30;
    const trialEnd = Math.floor(Date.now() / 1000) + trialDays * 86400;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      trial_end: trialEnd,
      payment_settings: { save_default_payment_method: "off" },
      metadata: { orgId, plan },
    });
    console.log(`  Created subscription: ${subscription.id} (trial until ${new Date(trialEnd * 1000).toISOString().slice(0, 10)}, active)`);

    // Write to Firestore (same fields the webhook writes)
    const periodEnd = trialEnd;
    const updates = {
      plan,
      ...limits,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: "active",
    };
    if (periodEnd) {
      updates.currentPeriodEnd = admin.firestore.Timestamp.fromMillis(periodEnd * 1000);
    }
    await orgRef.update(updates);
    console.log(`  ✓ Granted ${plan} (${interval}ly, via Stripe).\n`);
  }

  console.log("Done. Plan limits:");
  console.log(`  seats: ${limits.seatLimit === -1 ? "unlimited" : limits.seatLimit}`);
  console.log(`  clients: ${limits.clientLimit === -1 ? "unlimited" : limits.clientLimit}`);
  console.log(`  tasks: ${limits.taskLimit === -1 ? "unlimited" : limits.taskLimit}`);
  console.log(`  deliverables: ${limits.deliverableLimit === -1 ? "unlimited" : limits.deliverableLimit}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
