"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.app = void 0;
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
const express_1 = __importDefault(require("express"));
const firestore_1 = require("firebase-admin/firestore");
const cors_js_1 = require("./helpers/cors.js");
const auth_js_1 = require("./helpers/auth.js");
const reconcile_js_1 = require("./helpers/reconcile.js");
const stripe_js_1 = require("./helpers/stripe.js");
const plans_js_1 = require("./plans.js");
// How to add a secret later (do NOT define real ones in the scaffold):
//
//   import { defineSecret } from "firebase-functions/params";
//   const API_KEY = defineSecret("API_KEY");
//   export const api = onRequest({ secrets: [API_KEY], ... }, app);
//
// Set it with: firebase functions:secrets:set API_KEY
const VALID_ROUTES = [
    "GET /health",
    "POST /orgs",
    "GET /orgs/:orgId/invites/:inviteId",
    "POST /orgs/:orgId/invites/:inviteId/accept",
    "DELETE /orgs/:orgId/members/:uid",
    "POST /orgs/:orgId/reconcile",
    "GET /billing/config",
    "POST /billing/checkout",
    "POST /billing/portal",
    "POST /billing/webhook",
];
const MANAGER_ROLES = ["admin", "pm"];
const PAID_PLAN_IDS = ["studio", "agency"];
const BILLING_INTERVALS = ["month", "year"];
/** Error carrying an HTTP status — thrown inside handlers/transactions. */
class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/** Express 4 does not catch async errors — wrap every async handler. */
function asyncHandler(handler) {
    return (req, res) => {
        handler(req, res).catch((err) => {
            if (err instanceof ApiError) {
                res.status(err.status).json({ error: err.message });
                return;
            }
            v2_1.logger.error("api error", err);
            res.status(500).json({ error: "Internal error" });
        });
    };
}
function userOf(req) {
    return req.user;
}
function displayNameOf(user) {
    return (typeof user.name === "string" && user.name) || user.email || "";
}
function emailOf(user) {
    return (user.email ?? "").toLowerCase();
}
// ── Billing helpers ─────────────────────────────────────────────────────────
/** 403 unless the caller has a manager-role membership in the org. */
async function requireManagerOf(db, orgId, uid) {
    const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
    if (!snap.exists || !MANAGER_ROLES.includes(snap.get("role"))) {
        throw new ApiError(403, "Managers only");
    }
}
/** "cus_x" from a string-or-expanded Stripe reference field. */
function stripeIdOf(value) {
    if (typeof value === "string")
        return value;
    if (value && typeof value === "object" && "id" in value) {
        const id = value.id;
        if (typeof id === "string")
            return id;
    }
    return "";
}
/**
 * Subscription period end in epoch seconds. Newer Stripe API versions carry
 * current_period_end on the subscription item; older ones on the subscription.
 */
function periodEndOf(sub) {
    const item = sub.items?.data?.[0];
    const top = sub.current_period_end;
    const seconds = item?.current_period_end ?? top;
    return typeof seconds === "number" ? seconds : null;
}
/** The three limit fields for a plan, ready to spread into an org update. */
function limitsOf(plan) {
    const limits = plans_js_1.PLAN_LIMITS[plan];
    return { seatLimit: limits.seatLimit, clientLimit: limits.clientLimit, taskLimit: limits.taskLimit };
}
/** Org ref for a subscription: metadata.orgId, else lookup by subscription id. */
async function orgRefForSubscription(db, sub) {
    const orgId = sub.metadata?.orgId;
    if (typeof orgId === "string" && orgId)
        return db.doc(`orgs/${orgId}`);
    const q = await db.collection("orgs").where("stripeSubscriptionId", "==", sub.id).limit(1).get();
    return q.empty ? null : q.docs[0].ref;
}
/**
 * Idempotent org billing write: the billingEvents/{eventId} marker is created
 * in the same transaction as the org update, so a webhook replay is a no-op.
 */
async function applyBillingUpdate(db, event, orgRef, updates) {
    const markerRef = db.doc(`billingEvents/${event.id}`);
    await db.runTransaction(async (tx) => {
        const marker = await tx.get(markerRef);
        if (marker.exists) {
            v2_1.logger.info("stripe webhook: event already processed", { id: event.id, type: event.type });
            return;
        }
        tx.set(markerRef, {
            type: event.type,
            orgId: orgRef.id,
            processedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.update(orgRef, updates);
    });
}
/** Route a verified Stripe event to the matching org billing write. */
async function handleStripeEvent(event) {
    const db = (0, firestore_1.getFirestore)();
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const orgId = session.metadata?.orgId;
            const plan = session.metadata?.plan;
            const subscriptionId = stripeIdOf(session.subscription);
            if (!orgId || !plan || !PAID_PLAN_IDS.includes(plan) || !subscriptionId) {
                v2_1.logger.error("stripe webhook: checkout.session.completed missing metadata", {
                    id: event.id, orgId, plan, subscriptionId,
                });
                return;
            }
            const sub = await (0, stripe_js_1.getStripe)().subscriptions.retrieve(subscriptionId);
            const end = periodEndOf(sub);
            const updates = {
                stripeCustomerId: stripeIdOf(session.customer),
                stripeSubscriptionId: subscriptionId,
                plan,
                ...limitsOf(plan),
                subscriptionStatus: "active",
            };
            if (end)
                updates.currentPeriodEnd = firestore_1.Timestamp.fromMillis(end * 1000);
            await applyBillingUpdate(db, event, db.doc(`orgs/${orgId}`), updates);
            return;
        }
        case "customer.subscription.updated": {
            const sub = event.data.object;
            const orgRef = await orgRefForSubscription(db, sub);
            if (!orgRef) {
                v2_1.logger.error("stripe webhook: no org for subscription", { id: event.id, subscription: sub.id });
                return;
            }
            const priceId = sub.items?.data?.[0]?.price?.id ?? "";
            const plan = (0, stripe_js_1.planForPriceId)(priceId);
            const end = periodEndOf(sub);
            const updates = {
                stripeSubscriptionId: sub.id,
                subscriptionStatus: sub.status,
            };
            if (plan)
                Object.assign(updates, { plan, ...limitsOf(plan) });
            else
                v2_1.logger.warn("stripe webhook: unknown price id on subscription", { priceId, subscription: sub.id });
            if (end)
                updates.currentPeriodEnd = firestore_1.Timestamp.fromMillis(end * 1000);
            await applyBillingUpdate(db, event, orgRef, updates);
            return;
        }
        case "customer.subscription.deleted": {
            const sub = event.data.object;
            const orgRef = await orgRefForSubscription(db, sub);
            if (!orgRef) {
                v2_1.logger.error("stripe webhook: no org for subscription", { id: event.id, subscription: sub.id });
                return;
            }
            await applyBillingUpdate(db, event, orgRef, {
                plan: "free",
                ...limitsOf("free"),
                subscriptionStatus: "canceled",
                stripeSubscriptionId: firestore_1.FieldValue.delete(),
            });
            return;
        }
        case "invoice.payment_failed": {
            const invoice = event.data.object;
            const customerId = stripeIdOf(invoice.customer);
            if (!customerId) {
                v2_1.logger.error("stripe webhook: invoice without customer", { id: event.id });
                return;
            }
            const q = await db.collection("orgs").where("stripeCustomerId", "==", customerId).limit(1).get();
            if (q.empty) {
                v2_1.logger.error("stripe webhook: no org for customer", { id: event.id, customer: customerId });
                return;
            }
            await applyBillingUpdate(db, event, q.docs[0].ref, { subscriptionStatus: "past_due" });
            return;
        }
        default:
            v2_1.logger.info("stripe webhook: unhandled event type", { id: event.id, type: event.type });
    }
}
/**
 * Best-effort Stripe seat sync — quantity = current seat count. Called after
 * the seats transaction commits (invite accept, member removal). Never throws:
 * a Stripe hiccup must not fail the membership change.
 */
async function syncSeatQuantity(db, orgId) {
    try {
        if (!(0, stripe_js_1.billingEnabled)())
            return;
        const [orgSnap, usageSnap] = await Promise.all([
            db.doc(`orgs/${orgId}`).get(),
            db.doc(`orgs/${orgId}/usage/current`).get(),
        ]);
        const subscriptionId = orgSnap.get("stripeSubscriptionId");
        const seats = usageSnap.get("seats");
        if (typeof subscriptionId !== "string" || !subscriptionId)
            return;
        if (typeof seats !== "number" || seats < 1)
            return;
        const stripe = (0, stripe_js_1.getStripe)();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const item = sub.items?.data?.[0];
        if (!item || item.quantity === seats)
            return;
        await stripe.subscriptions.update(subscriptionId, {
            items: [{ id: item.id, quantity: seats }],
            proration_behavior: "create_prorations",
        });
        v2_1.logger.info("stripe seat sync", { orgId, seats });
    }
    catch (err) {
        v2_1.logger.warn("stripe seat sync failed (ignored)", { orgId, err });
    }
}
const app = (0, express_1.default)();
exports.app = app;
// CORS first (also terminates preflights)…
app.use((req, res, next) => {
    if ((0, cors_js_1.applyCors)(req, res))
        return; // preflight handled
    v2_1.logger.info("api request", { method: req.method, path: req.path });
    next();
});
// ── POST /billing/webhook (Stripe signature, NOT requireAuth) ───────────────
// Registered BEFORE express.json(): signature verification needs the exact
// raw bytes. firebase-functions v2 exposes them as req.rawBody — the most
// robust source (works in the emulator and in prod regardless of parsers).
app.post("/billing/webhook", asyncHandler(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    if (!(0, stripe_js_1.billingEnabled)() || !secret) {
        throw new ApiError(503, "billing_disabled");
    }
    const signature = req.headers["stripe-signature"];
    const rawBody = req.rawBody;
    if (typeof signature !== "string" || !rawBody) {
        throw new ApiError(400, "invalid_signature");
    }
    let event;
    try {
        event = (0, stripe_js_1.getStripe)().webhooks.constructEvent(rawBody, signature, secret);
    }
    catch (err) {
        v2_1.logger.warn("stripe webhook: signature verification failed", { err });
        throw new ApiError(400, "invalid_signature");
    }
    // Handler failures respond 500 so Stripe RETRIES the event — otherwise a
    // transient error would silently drop e.g. a paid upgrade. Replays are
    // safe: billingEvents/{event.id} makes the org write idempotent.
    // Unhandled event types still resolve normally (200, no retry).
    try {
        await handleStripeEvent(event);
    }
    catch (err) {
        v2_1.logger.error("stripe webhook: handler failed (500 → Stripe retries)", { id: event.id, type: event.type, err });
        throw new ApiError(500, "handler_failed");
    }
    res.json({ received: true });
}));
// …then JSON body parsing for everything else.
app.use(express_1.default.json());
// ── GET /health (public) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});
// ── /billing — checkout/portal/config require a verified ID token ──────────
const billing = express_1.default.Router();
billing.use(auth_js_1.requireAuth);
// GET /billing/config — is billing live, and what do the paid plans cost?
// Any signed-in member may read this (it powers the pricing/upgrade UI).
billing.get("/config", (_req, res) => {
    res.json({
        enabled: (0, stripe_js_1.billingEnabled)(),
        plans: {
            studio: { ...limitsOf("studio"), ...plans_js_1.DISPLAY_PRICES.studio },
            agency: { ...limitsOf("agency"), ...plans_js_1.DISPLAY_PRICES.agency },
        },
    });
});
// POST /billing/checkout { orgId, plan, interval } — manager-only. Creates
// (or reuses) the org's Stripe customer and opens a subscription Checkout
// Session with quantity = current seats. The webhook does the org writes.
billing.post("/checkout", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : "";
    const plan = req.body?.plan;
    const interval = req.body?.interval;
    if (!orgId || !PAID_PLAN_IDS.includes(plan) || !BILLING_INTERVALS.includes(interval)) {
        throw new ApiError(400, "orgId, plan ('studio'|'agency') and interval ('month'|'year') are required");
    }
    if (!(0, stripe_js_1.billingEnabled)())
        throw new ApiError(503, "billing_disabled");
    const db = (0, firestore_1.getFirestore)();
    await requireManagerOf(db, orgId, user.uid);
    const orgRef = db.doc(`orgs/${orgId}`);
    const [orgSnap, usageSnap] = await Promise.all([
        orgRef.get(),
        db.doc(`orgs/${orgId}/usage/current`).get(),
    ]);
    if (!orgSnap.exists)
        throw new ApiError(404, "Org not found");
    const stripe = (0, stripe_js_1.getStripe)();
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
    const seats = usageSnap.get("seats");
    const quantity = Math.max(typeof seats === "number" ? seats : 0, 1);
    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: (0, stripe_js_1.priceIdFor)(plan, interval), quantity }],
        subscription_data: { metadata: { orgId, plan } },
        metadata: { orgId, plan },
        success_url: `${(0, stripe_js_1.appUrl)()}/settings?billing=success`,
        cancel_url: `${(0, stripe_js_1.appUrl)()}/settings?billing=cancelled`,
    });
    res.json({ url: session.url });
}));
// POST /billing/portal { orgId } — manager-only Stripe Billing Portal session
// (payment method, invoices, cancel). Requires an existing Stripe customer.
billing.post("/portal", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : "";
    if (!orgId)
        throw new ApiError(400, "orgId is required");
    if (!(0, stripe_js_1.billingEnabled)())
        throw new ApiError(503, "billing_disabled");
    const db = (0, firestore_1.getFirestore)();
    await requireManagerOf(db, orgId, user.uid);
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    if (!orgSnap.exists)
        throw new ApiError(404, "Org not found");
    const customerId = orgSnap.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
        throw new ApiError(409, "no_customer");
    }
    const session = await (0, stripe_js_1.getStripe)().billingPortal.sessions.create({
        customer: customerId,
        return_url: `${(0, stripe_js_1.appUrl)()}/settings`,
    });
    res.json({ url: session.url });
}));
app.use("/billing", billing);
// ── /orgs — everything below requires a verified ID token ──────────────────
const orgs = express_1.default.Router();
orgs.use(auth_js_1.requireAuth);
// POST /orgs — self-serve workspace creation. One batch: org doc (billing
// block from PLAN_LIMITS), users/{uid} identity upsert, owner membership
// (denormalized for collection-group queries + org switcher), usage counters
// (seats is functions-maintained; activeClients/activeTasks are the Phase 2
// entitlement counters the app batch-increments with domain writes).
orgs.post("/", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 60) {
        throw new ApiError(400, "name must be a non-empty string of at most 60 characters");
    }
    const db = (0, firestore_1.getFirestore)();
    const orgRef = db.collection("orgs").doc();
    const displayName = displayNameOf(user);
    const email = emailOf(user);
    const batch = db.batch();
    batch.set(orgRef, {
        name,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        ownerUid: user.uid,
        plan: "free",
        seatLimit: plans_js_1.PLAN_LIMITS.free.seatLimit,
        clientLimit: plans_js_1.PLAN_LIMITS.free.clientLimit,
        taskLimit: plans_js_1.PLAN_LIMITS.free.taskLimit,
        subscriptionStatus: "none",
    });
    batch.set(db.doc(`users/${user.uid}`), { displayName, email, createdAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    batch.set(orgRef.collection("members").doc(user.uid), {
        uid: user.uid,
        orgId: orgRef.id,
        orgName: name,
        displayName,
        email,
        role: "admin",
        joinedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    batch.set(orgRef.collection("usage").doc("current"), {
        seats: 1,
        activeClients: 0,
        activeTasks: 0,
    });
    await batch.commit();
    res.status(201).json({ orgId: orgRef.id });
}));
// GET /orgs/:orgId/invites/:inviteId — invite preview for the accept screen.
// 404 unless the invite exists, is pending, and is addressed to the caller.
orgs.get("/:orgId/invites/:inviteId", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, inviteId } = req.params;
    const db = (0, firestore_1.getFirestore)();
    const [orgSnap, inviteSnap] = await Promise.all([
        db.doc(`orgs/${orgId}`).get(),
        db.doc(`orgs/${orgId}/invites/${inviteId}`).get(),
    ]);
    const invite = inviteSnap.data();
    if (!orgSnap.exists || !invite || invite.status !== "pending" || invite.email !== emailOf(user)) {
        throw new ApiError(404, "Invite not found");
    }
    res.json({ orgName: orgSnap.get("name"), role: invite.role, email: invite.email });
}));
// POST /orgs/:orgId/invites/:inviteId/accept — create the membership
// (role/clientId from the invite, identity denormalized from the token),
// bump the seat counter, mark the invite accepted — one transaction.
// Idempotent: an existing member gets 200 with no writes. Seat-gated:
// 409 { error: 'seat_limit' } when the org is at its seat limit (the app
// shows an upsell) — the rules gate invite CREATION, but seats are consumed
// at accept time, so the transaction re-checks with fresh counters.
orgs.post("/:orgId/invites/:inviteId/accept", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, inviteId } = req.params;
    const db = (0, firestore_1.getFirestore)();
    const orgRef = db.doc(`orgs/${orgId}`);
    const inviteRef = db.doc(`orgs/${orgId}/invites/${inviteId}`);
    const memberRef = db.doc(`orgs/${orgId}/members/${user.uid}`);
    const usageRef = db.doc(`orgs/${orgId}/usage/current`);
    await db.runTransaction(async (tx) => {
        const [orgSnap, inviteSnap, memberSnap, usageSnap] = await Promise.all([
            tx.get(orgRef),
            tx.get(inviteRef),
            tx.get(memberRef),
            tx.get(usageRef),
        ]);
        if (memberSnap.exists)
            return; // already a member — idempotent success
        const invite = inviteSnap.data();
        if (!orgSnap.exists || !invite || invite.status !== "pending" || invite.email !== emailOf(user)) {
            throw new ApiError(404, "Invite not found");
        }
        // Seat gate (server-side twin of the invites-create rule; -1 = unlimited).
        const seatLimit = orgSnap.get("seatLimit");
        const seats = usageSnap.get("seats");
        if (typeof seatLimit === "number" && seatLimit !== -1 &&
            typeof seats === "number" && seats >= seatLimit) {
            throw new ApiError(409, "seat_limit");
        }
        const member = {
            uid: user.uid,
            orgId,
            orgName: orgSnap.get("name"),
            displayName: displayNameOf(user),
            email: emailOf(user),
            role: invite.role,
            joinedAt: firestore_1.FieldValue.serverTimestamp(),
            // Nullish-coalesce: Firestore rejects `undefined`, and an invite doc
            // written without invitedBy must not 500 the whole accept.
            invitedBy: invite.invitedBy ?? null,
        };
        if (invite.clientId)
            member.clientId = invite.clientId;
        tx.set(memberRef, member);
        tx.update(usageRef, { seats: firestore_1.FieldValue.increment(1) });
        tx.update(inviteRef, { status: "accepted" });
    });
    // Seat billing follows membership (best effort — never fails the accept).
    await syncSeatQuantity(db, orgId);
    res.json({ orgId });
}));
// DELETE /orgs/:orgId/members/:uid — remove a member (manager) or leave
// (uid == caller). The owner can never be removed. Transaction keeps the
// seat counter in step with the membership delete.
orgs.delete("/:orgId/members/:uid", asyncHandler(async (req, res) => {
    const caller = userOf(req);
    const { orgId, uid } = req.params;
    const db = (0, firestore_1.getFirestore)();
    const orgRef = db.doc(`orgs/${orgId}`);
    const memberRef = db.doc(`orgs/${orgId}/members/${uid}`);
    const usageRef = db.doc(`orgs/${orgId}/usage/current`);
    await db.runTransaction(async (tx) => {
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw new ApiError(404, "Org not found");
        if (orgSnap.get("ownerUid") === uid)
            throw new ApiError(409, "The org owner cannot be removed");
        if (uid !== caller.uid) {
            const callerSnap = await tx.get(db.doc(`orgs/${orgId}/members/${caller.uid}`));
            if (!callerSnap.exists || !MANAGER_ROLES.includes(callerSnap.get("role"))) {
                throw new ApiError(403, "Managers only");
            }
        }
        const memberSnap = await tx.get(memberRef);
        if (!memberSnap.exists)
            throw new ApiError(404, "Member not found");
        tx.delete(memberRef);
        tx.update(usageRef, { seats: firestore_1.FieldValue.increment(-1) });
    });
    // Seat billing follows membership (best effort — never fails the removal).
    await syncSeatQuantity(db, orgId);
    res.status(204).send();
}));
// POST /orgs/:orgId/reconcile — recount members/clients/tasks (aggregate
// queries) and heal the usage counters. Manager-only. This is the dev-mode
// trigger for the nightly `reconcileUsage` schedule (the emulator never fires
// schedules) and the support tool for a drifted org. Responds 200 with
// { orgId, healed, before, after } whether or not anything changed.
orgs.post("/:orgId/reconcile", asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const db = (0, firestore_1.getFirestore)();
    await requireManagerOf(db, orgId, user.uid);
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    if (!orgSnap.exists)
        throw new ApiError(404, "Org not found");
    res.json(await (0, reconcile_js_1.reconcileOrg)(orgId));
}));
app.use("/orgs", orgs);
// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        error: "Not found",
        route: `${req.method} ${req.path}`,
        validRoutes: VALID_ROUTES,
    });
});
/**
 * Single HTTP function hosting the Express app. `/health` is public;
 * `/billing/webhook` is authenticated by Stripe signature; everything under
 * `/orgs` and `/billing` requires a verified Firebase ID token
 * (see helpers/auth.ts). Validate any request body before trusting it.
 */
exports.api = (0, https_1.onRequest)({ region: "us-central1", maxInstances: 10 }, app);
