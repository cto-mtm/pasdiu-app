import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import express from "express";
import { applyCors } from "./helpers/cors.js";
import { healthRouter } from "./routes/health.js";
import { billingRouter, billingWebhookHandler } from "./routes/billing.js";
import { orgsRouter } from "./routes/orgs.js";
import { deliverablesRouter } from "./routes/deliverables.js";
import { approvalRouter } from "./routes/approval.js";
import { calendarRouter } from "./routes/calendar.js";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const VALID_ROUTES = [
  "GET /health",
  "POST /orgs",
  "PATCH /orgs/:orgId",
  "GET /orgs/my-invites",
  "GET /orgs/:orgId/invites/:inviteId/preview",
  "GET /orgs/:orgId/invites/:inviteId",
  "POST /orgs/:orgId/invites/:inviteId/accept",
  "POST /orgs/:orgId/invites/:inviteId/resend",
  "DELETE /orgs/:orgId/members/:uid",
  "POST /orgs/:orgId/reconcile",
  "POST /orgs/:orgId/deliverables/batch",
  "POST /orgs/:orgId/deliverables/:deliverableId/approve",
  "POST /orgs/:orgId/deliverables/:deliverableId/request-changes",
  "POST /orgs/:orgId/deliverables/bulk-approve",
  "POST /orgs/:orgId/calendar-feed",
  "GET /calendar/:token",
  "GET /billing/config",
  "POST /billing/checkout",
  "POST /billing/portal",
  "POST /billing/webhook",
];

const app = express();

// CORS first (also terminates preflights)…
app.use((req, res, next) => {
  if (applyCors(req, res)) return; // preflight handled
  logger.info("api request", { method: req.method, path: req.path });
  next();
});

// ── POST /billing/webhook (Stripe signature, NOT requireAuth) ───────────────
// Registered BEFORE express.json(): signature verification needs the exact
// raw bytes. firebase-functions v2 exposes them as req.rawBody — the most
// robust source (works in the emulator and in prod regardless of parsers).
app.post("/billing/webhook", billingWebhookHandler);

// …then JSON body parsing for everything else.
app.use(express.json());

// ── Route Mounts ────────────────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/billing", billingRouter);
app.use("/orgs", orgsRouter);
app.use("/orgs", deliverablesRouter);
app.use("/orgs", approvalRouter);
// Mounted at root: it carries both the authed /orgs/:orgId/calendar-feed
// creator and the public token-authed /calendar/:token feed.
app.use(calendarRouter);

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    route: `${req.method} ${req.path}`,
    validRoutes: VALID_ROUTES,
  });
});

// The raw express app, exported for the integration tests (test/helpers.ts
// wraps it with supertest). Production traffic always enters via `api` below.
export { app };

/**
 * Single HTTP function hosting the Express app. `/health` is public;
 * `/billing/webhook` is authenticated by Stripe signature; everything under
 * `/orgs` and `/billing` requires a verified Firebase ID token
 * (see helpers/auth.ts). Validate any request body before trusting it.
 */
export const api = onRequest(
  {
    region: "us-east5",
    cors: true,
    invoker: "public",
    maxInstances: 10,
    // Secret Manager injection in prod — without this, the deployed function
    // never sees the values and billing stays disabled. The emulator ignores
    // it and reads functions/.env instead.
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  app
);
