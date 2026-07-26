// Integration-test toolkit — the single place tests get requests, tokens,
// seeds, and utilities from (see docs/testing.md). Everything runs against
// the LIVE express app and the Firestore + Auth emulators: real token
// verification, real middleware, real Firestore. No mocked auth, and tests
// never hand-write Firestore documents inline (factory drift from production
// shapes is how tests pass while prod breaks).
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import express from "express";
import type { Request } from "express";
import request from "supertest";
import Stripe from "stripe";
import { app } from "../src/api.js";
import { PLAN_LIMITS } from "../src/plans.js";

export const PROJECT = process.env.GCLOUD_PROJECT ?? "demo-app";

// test/setup.ts (setupFiles) has already exported the emulator hosts —
// initialize the Admin SDK once per test file (makeUserToken + seed factories
// use it; the app's own handlers call getFirestore()/getAuth() lazily).
if (getApps().length === 0) initializeApp({ projectId: PROJECT });

// ── Request client (supertest over the real express app) ───────────────────
//
// In production the app runs behind firebase-functions' onRequest, which
// buffers the raw request bytes as req.rawBody (Stripe signature verification
// in POST /billing/webhook depends on it), pre-parses JSON bodies, and marks
// them parsed. supertest hits the bare express app, so this harness
// reproduces that platform behavior before delegating to the real app — the
// app's own express.json() then no-ops (body-parser's req._body flag),
// exactly as it does in production.
export const harness = express();
harness.use((req, _res, next) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    (req as Request & { rawBody?: Buffer }).rawBody = raw;
    (req as unknown as { _body: boolean })._body = true; // body-parser: already parsed
    const type = String(req.headers["content-type"] ?? "");
    if (raw.length > 0 && type.includes("application/json")) {
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    next();
  });
});
harness.use(app);

/** Authorization header for an authenticated request (pass to .set()). */
export function authH(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// The single way tests issue authenticated requests. supertest requests are
// thenable: `const res = await post("/orgs", token, { name: "X" })`.
export const get = (path: string, token: string) => request(harness).get(path).set(authH(token));
export const post = (path: string, token: string, body?: unknown) =>
  request(harness).post(path).set(authH(token)).send((body ?? {}) as object);
export const del = (path: string, token: string) => request(harness).delete(path).set(authH(token));

// Unauthenticated variants for the 401 leg of the coverage matrix.
export const getAnon = (path: string) => request(harness).get(path);
export const postAnon = (path: string, body?: unknown) =>
  request(harness).post(path).send((body ?? {}) as object);
export const delAnon = (path: string) => request(harness).delete(path);

/** POST /billing/webhook with an exact raw payload (+ optional signature). */
export const postWebhook = (payload: string, signature?: string) => {
  const req = request(harness).post("/billing/webhook").type("application/json");
  if (signature !== undefined) void req.set("stripe-signature", signature);
  return req.send(payload);
};

// ── Real token minting via the Auth emulator ────────────────────────────────

const AUTH_HOST = () => process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/**
 * Create-or-update an Auth-emulator user and sign in through the emulator's
 * REST API for a REAL ID token — the app's requireAuth middleware then runs
 * verifyIdToken for real (including the email_verified gate, so
 * `emailVerified: false` is a first-class test axis). There are no custom
 * claims in this app: roles live on orgs/{orgId}/members/{uid} docs
 * (seedMember). Idempotent — Auth users persist across clearFirestore(), so
 * re-used uids must not throw; still, prefer unique uids per test.
 */
export async function makeUserToken(opts: {
  uid: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string;
}): Promise<string> {
  const auth = getAuth();
  const password = "test-pass-123";
  const emailVerified = opts.emailVerified ?? true;
  const displayName = opts.displayName ?? `Test ${opts.uid}`;
  try {
    await auth.createUser({ uid: opts.uid, email: opts.email, password, emailVerified, displayName });
  } catch {
    await auth.updateUser(opts.uid, { email: opts.email, password, emailVerified, displayName });
  }

  // Production invariant: an authenticated user always has a users/{uid}
  // identity doc (identity ONLY — role/clientId live on member docs). POST
  // /orgs merge-upserts it and seed.mjs writes it; mirror it here so tests
  // never run in a phantom state production can't be in.
  await getFirestore()
    .doc(`users/${opts.uid}`)
    .set({ displayName, email: opts.email.toLowerCase(), createdAt: new Date() }, { merge: true });

  // Any API key works against the emulator.
  const res = await fetch(
    `http://${AUTH_HOST()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: opts.email, password, returnSecureToken: true }),
    }
  );
  const body = (await res.json()) as { idToken?: string; error?: unknown };
  if (!body.idToken) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

// ── State reset between tests ───────────────────────────────────────────────

/**
 * Wipe emulator Firestore between tests (one REST DELETE, no SDK iteration).
 * Call it in beforeEach — never afterEach — so a crashed prior test can't
 * poison the next one. Auth users are NOT wiped (see makeUserToken).
 */
export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`clearFirestore failed: HTTP ${res.status}`);
}

// ── Seed factories ──────────────────────────────────────────────────────────
//
// Every factory writes a COMPLETE, production-shaped document (matching what
// src/api.ts, seed.mjs, and firestore.rules produce/expect) with sensible
// defaults, and takes an `over` object spread last so tests override only
// what the scenario needs. Passing `undefined` for a field in `over` REMOVES
// it (Firestore rejects undefined values) — e.g. an invite without invitedBy.

type Doc = Record<string, unknown>;

function withoutUndefined(doc: Doc): Doc {
  return Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
}

/** Org doc with a complete free-plan billing block (mirrors POST /orgs). */
export async function seedOrg(orgId: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`orgs/${orgId}`)
    .set(
      withoutUndefined({
        name: `Org ${orgId}`,
        createdAt: new Date(),
        ownerUid: `owner-${orgId}`,
        plan: "free",
        seatLimit: PLAN_LIMITS.free.seatLimit,
        clientLimit: PLAN_LIMITS.free.clientLimit,
        taskLimit: PLAN_LIMITS.free.taskLimit,
        subscriptionStatus: "none",
        ...over,
      })
    );
}

/**
 * Membership doc — the tenancy source of truth (roles live HERE, not on
 * custom claims). Denormalized identity fields mirror what invite-accept and
 * org-create write. Default orgName matches seedOrg's default.
 */
export async function seedMember(
  orgId: string,
  uid: string,
  role: "admin" | "pm" | "contractor" | "client",
  over: Doc = {}
): Promise<void> {
  await getFirestore()
    .doc(`orgs/${orgId}/members/${uid}`)
    .set(
      withoutUndefined({
        uid,
        orgId,
        orgName: `Org ${orgId}`,
        displayName: `Test ${uid}`,
        email: `${uid}@test.dev`,
        role,
        joinedAt: new Date(),
        ...over,
      })
    );
}

/** orgs/{orgId}/usage/current counters (functions-owned doc). */
export async function seedUsage(orgId: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`orgs/${orgId}/usage/current`)
    .set(withoutUndefined({ seats: 1, activeClients: 0, activeTasks: 0, activeDeliverables: 0, ...over }));
}

/** Pending invite (shape mirrors the app's createInvite + rules). */
export async function seedInvite(orgId: string, inviteId: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`orgs/${orgId}/invites/${inviteId}`)
    .set(
      withoutUndefined({
        email: "invitee@test.dev", // rules require lowercase
        role: "contractor",
        status: "pending",
        createdAt: new Date(),
        invitedBy: "u-inviter",
        ...over,
      })
    );
}

/** Top-level client doc stamped with its orgId (shape mirrors seed.mjs). */
export async function seedClient(orgId: string, id: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`clients/${id}`)
    .set(
      withoutUndefined({
        orgId,
        name: `Client ${id}`,
        meta: [],
        ...over,
      })
    );
}

/** Top-level task doc stamped with its orgId (shape mirrors seed.mjs). */
export async function seedTask(orgId: string, id: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`tasks/${id}`)
    .set(
      withoutUndefined({
        orgId,
        title: `Task ${id}`,
        description: `Deliverable: Task ${id}.`,
        subGroupId: "sg-test",
        projectId: "p-test",
        clientId: "c-test",
        status: "backlog",
        assigneeUid: "u-assignee",
        clientVisible: false,
        blockedReason: "",
        blockedAt: null,
        deliveryNote: "",
        meta: [],
        order: 0,
        dueAt: new Date(Date.now() + 2 * 86400000),
        createdAt: new Date(),
        completedAt: null,
        deliverableId: "",
        stageId: "",
        ...over,
      })
    );
}

/** Top-level deliverable doc (functions-only creation). */
export async function seedDeliverable(orgId: string, id: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`deliverables/${id}`)
    .set(
      withoutUndefined({
        orgId,
        clientId: "c-test",
        projectId: "p-test",
        subGroupId: "sg-test",
        subGroupName: "Test SubGroup",
        typeId: "dt-test",
        stages: [
          { id: "s_capture", name: "Capture", optional: false, clientFacing: false },
          { id: "s_edit", name: "Edit", optional: false, clientFacing: false },
          { id: "s_review", name: "Review", optional: false, clientFacing: true },
        ],
        stageSummary: [],
        name: `Deliverable ${id}`,
        status: "active",
        clientVisible: false,
        latestVersionUrl: "",
        order: 0,
        meta: [],
        createdAt: new Date(),
        deliveredAt: null,
        approvedBy: "",
        approvedVia: "",
        approvedAt: null,
        approvalNote: "",
        ...over,
      })
    );
}

/** Top-level deliverableType doc stamped with its orgId. */
export async function seedDeliverableType(orgId: string, id: string, over: Doc = {}): Promise<void> {
  await getFirestore()
    .doc(`deliverableTypes/${id}`)
    .set(
      withoutUndefined({
        orgId,
        name: `Type ${id}`,
        weight: 1,
        order: 0,
        ...over,
      })
    );
}

// ── Stripe test utilities (no mocking, no network) ─────────────────────────

const STRIPE_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STUDIO_MONTHLY",
  "STRIPE_PRICE_STUDIO_ANNUAL",
  "STRIPE_PRICE_AGENCY_MONTHLY",
  "STRIPE_PRICE_AGENCY_ANNUAL",
] as const;
export type StripeEnvKey = (typeof STRIPE_ENV_KEYS)[number];

/**
 * Set EXACTLY the given Stripe env vars (all other Stripe keys are unset) and
 * return a restore function — call it in afterAll. billingEnabled() and
 * priceIdFor() read process.env lazily on every call, so this takes effect
 * immediately. Caveat: getStripe() caches its client after the first call,
 * but no offline-testable code path uses the client's API key
 * (webhooks.constructEvent only uses the secret argument), so the cache is
 * harmless here.
 */
export function stripeEnv(values: Partial<Record<StripeEnvKey, string>> = {}): () => void {
  const saved = new Map<StripeEnvKey, string | undefined>();
  for (const key of STRIPE_ENV_KEYS) {
    saved.set(key, process.env[key]);
    const v = values[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  return () => {
    for (const [key, v] of saved) {
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  };
}

/**
 * Offline Stripe-Signature header for a raw payload — pure HMAC, no network
 * (stripe.webhooks.generateTestHeaderString). Sign EXACTLY the string you
 * send with postWebhook().
 */
export function stripeSignature(payload: string, secret: string): string {
  return new Stripe("sk_test_offline_signer").webhooks.generateTestHeaderString({ payload, secret });
}

// ── Utilities ───────────────────────────────────────────────────────────────

/**
 * Poll `fn` until `predicate` holds or the timeout elapses, then return the
 * last value (the caller asserts on it). For fire-and-forget side effects —
 * never assert those with sleeps. Fast on success, only spends the full
 * budget when something's wrong.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 3000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

/** True if `key` appears ANYWHERE in `value` (recursively) — leak assertion. */
export function containsKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => containsKeyDeep(v, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k === key || containsKeyDeep(v, key)
    );
  }
  return false;
}
