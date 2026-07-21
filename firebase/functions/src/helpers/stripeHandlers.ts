import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type Stripe from "stripe";
import {
  billingEnabled,
  getStripe,
  planForPriceId,
} from "./stripe.js";
import { PLAN_LIMITS } from "../plans.js";
import type { PaidPlanId } from "../plans.js";

export const PAID_PLAN_IDS: PaidPlanId[] = ["studio", "agency"];

/** "cus_x" from a string-or-expanded Stripe reference field. */
export function stripeIdOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

/**
 * Subscription period end in epoch seconds. Newer Stripe API versions carry
 * current_period_end on the subscription item; older ones on the subscription.
 */
export function periodEndOf(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const seconds = item?.current_period_end ?? top;
  return typeof seconds === "number" ? seconds : null;
}

/** The three limit fields for a plan, ready to spread into an org update. */
export function limitsOf(plan: keyof typeof PLAN_LIMITS) {
  const limits = PLAN_LIMITS[plan];
  return { seatLimit: limits.seatLimit, clientLimit: limits.clientLimit, taskLimit: limits.taskLimit };
}

/** Org ref for a subscription: metadata.orgId, else lookup by subscription id. */
export async function orgRefForSubscription(
  db: Firestore,
  sub: Stripe.Subscription
): Promise<DocumentReference | null> {
  const orgId = sub.metadata?.orgId;
  if (typeof orgId === "string" && orgId) return db.doc(`orgs/${orgId}`);
  const q = await db.collection("orgs").where("stripeSubscriptionId", "==", sub.id).limit(1).get();
  return q.empty ? null : q.docs[0].ref;
}

/**
 * Idempotent org billing write: the billingEvents/{eventId} marker is created
 * in the same transaction as the org update, so a webhook replay is a no-op.
 */
export async function applyBillingUpdate(
  db: Firestore,
  event: Stripe.Event,
  orgRef: DocumentReference,
  updates: Record<string, unknown>
): Promise<void> {
  const markerRef = db.doc(`billingEvents/${event.id}`);
  await db.runTransaction(async (tx) => {
    const marker = await tx.get(markerRef);
    if (marker.exists) {
      logger.info("stripe webhook: event already processed", { id: event.id, type: event.type });
      return;
    }
    tx.set(markerRef, {
      type: event.type,
      orgId: orgRef.id,
      processedAt: FieldValue.serverTimestamp(),
    });
    tx.update(orgRef, updates);
  });
}

/** Route a verified Stripe event to the matching org billing write. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const db = getFirestore();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      const plan = session.metadata?.plan as PaidPlanId | undefined;
      const subscriptionId = stripeIdOf(session.subscription);
      if (!orgId || !plan || !PAID_PLAN_IDS.includes(plan) || !subscriptionId) {
        logger.error("stripe webhook: checkout.session.completed missing metadata", {
          id: event.id, orgId, plan, subscriptionId,
        });
        return;
      }
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const end = periodEndOf(sub);
      const updates: Record<string, unknown> = {
        stripeCustomerId: stripeIdOf(session.customer),
        stripeSubscriptionId: subscriptionId,
        plan,
        ...limitsOf(plan),
        subscriptionStatus: "active",
      };
      if (end) updates.currentPeriodEnd = Timestamp.fromMillis(end * 1000);
      await applyBillingUpdate(db, event, db.doc(`orgs/${orgId}`), updates);
      return;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const orgRef = await orgRefForSubscription(db, sub);
      if (!orgRef) {
        logger.error("stripe webhook: no org for subscription", { id: event.id, subscription: sub.id });
        return;
      }
      const priceId = sub.items?.data?.[0]?.price?.id ?? "";
      const plan = await planForPriceId(priceId);
      const end = periodEndOf(sub);
      const updates: Record<string, unknown> = {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: sub.status,
      };
      if (plan) Object.assign(updates, { plan, ...limitsOf(plan) });
      else logger.warn("stripe webhook: unknown price id on subscription", { priceId, subscription: sub.id });
      if (end) updates.currentPeriodEnd = Timestamp.fromMillis(end * 1000);
      await applyBillingUpdate(db, event, orgRef, updates);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgRef = await orgRefForSubscription(db, sub);
      if (!orgRef) {
        logger.error("stripe webhook: no org for subscription", { id: event.id, subscription: sub.id });
        return;
      }
      await applyBillingUpdate(db, event, orgRef, {
        plan: "free",
        ...limitsOf("free"),
        subscriptionStatus: "canceled",
        stripeSubscriptionId: FieldValue.delete(),
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = stripeIdOf(invoice.customer);
      if (!customerId) {
        logger.error("stripe webhook: invoice without customer", { id: event.id });
        return;
      }
      const q = await db.collection("orgs").where("stripeCustomerId", "==", customerId).limit(1).get();
      if (q.empty) {
        logger.error("stripe webhook: no org for customer", { id: event.id, customer: customerId });
        return;
      }
      await applyBillingUpdate(db, event, q.docs[0].ref, { subscriptionStatus: "past_due" });
      return;
    }

    default:
      logger.info("stripe webhook: unhandled event type", { id: event.id, type: event.type });
  }
}

/**
 * Best-effort Stripe seat sync — quantity = current seat count. Called after
 * the seats transaction commits (invite accept, member removal). Never throws:
 * a Stripe hiccup must not fail the membership change.
 */
export async function syncSeatQuantity(db: Firestore, orgId: string): Promise<void> {
  try {
    if (!billingEnabled()) return;
    const [orgSnap, usageSnap] = await Promise.all([
      db.doc(`orgs/${orgId}`).get(),
      db.doc(`orgs/${orgId}/usage/current`).get(),
    ]);
    const subscriptionId = orgSnap.get("stripeSubscriptionId");
    const seats = usageSnap.get("seats");
    if (typeof subscriptionId !== "string" || !subscriptionId) return;
    if (typeof seats !== "number" || seats < 1) return;
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items?.data?.[0];
    if (!item || item.quantity === seats) return;
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: "create_prorations",
    });
    logger.info("stripe seat sync", { orgId, seats });
  } catch (err) {
    logger.warn("stripe seat sync failed (ignored)", { orgId, err });
  }
}
