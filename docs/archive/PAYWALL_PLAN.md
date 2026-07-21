# Paywall & Pricing Implementation Plan

**Date:** 2026-07-09 · **Companion docs:** `BUSINESS_MODEL.md` (tiers & economics), `AUDIT.md`
**Scope:** everything needed to charge money — multi-tenancy, Stripe billing, entitlement enforcement, pricing page, upgrade UX, and instrumentation. Media stays link-based (MVP decision), so no Storage work appears here.

---

## The one hard prerequisite: the app is currently single-workspace

Everything in `firestore.rules` and `stores/data.ts` assumes **one** team sharing one Firebase project: `users`, `clients`, `projects`, `tasks` are project-global; only client-role users are tenant-scoped (via `clientId`). You cannot onboard a second paying customer into this structure. So the paywall work starts with an organization layer — this is the majority of the engineering effort, and it's also where the deferred pagination fix (AUDIT E3) naturally lands, since every query is being touched anyway.

**Phase order:** 0) multi-tenancy → 1) Stripe billing engine → 2) entitlement gates → 3) pricing page & upgrade UX → 4) instrumentation & launch. Phases 1–2 can overlap once 0 is stable. Rough sizing for one experienced dev: **0: 2–3 wks · 1: 1–1.5 wks · 2: 1 wk · 3: 1 wk · 4: 0.5 wk + ongoing** ≈ 6–7 weeks to revenue-ready.

---

## Phase 0 — Multi-tenancy (workspaces with multi-org membership) ✅ IMPLEMENTED 2026-07-10

> Shipped as specced (membership docs, org-scoped rules + queries with pagination, self-serve signup → `/welcome`, invite links, org switcher, two-org seed with a shared contractor). Outstanding: run `npm run build` in `firebase/functions` (compiled `lib/` is hand-mirrored), re-seed, and run the rules test suite against the emulator.

**Core requirement: one person, many organizations.** A freelance editor works for several studios at once; each studio invites the same account into its own workspace. Identity is therefore global, but **role is per-membership** — the same person can be a contractor in org A, a PM in org B, and a client reviewer in org C.

**Data model.**
- `orgs/{orgId}`: `name`, `createdAt`, `ownerUid`, and a billing block written *only* by Cloud Functions (`plan: 'free' | 'studio' | 'agency'`, `seatLimit`, `clientLimit`, `taskLimit`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, `currentPeriodEnd`).
- `orgs/{orgId}/members/{uid}`: `role`, `clientId` (for client-role members), `joinedAt`, `invitedBy`. **This is the tenancy source of truth** — one doc per person per org. `users/{uid}` shrinks to global identity only (`displayName`, `email`); `role`/`clientId` move into memberships.
- Every domain doc gains `orgId` (`clients`, `projects`, `subGroups`, `tasks`; `versions`/`notes` inherit through their parent task).
- `orgs/{orgId}/usage/current` counter doc (`seats`, `activeClients`, `activeTasks`), maintained transactionally — Firestore rules can't count collections, so gates read this doc (see Phase 2). `seats` = membership count: a contractor in two orgs occupies (and is billed as) a seat in each — the Slack/Notion model, and fair, since each org gets full value.

**Rules.** Helpers become membership lookups: `member(orgId): get(/databases/$(db)/documents/orgs/$(orgId)/members/$(request.auth.uid))`, with `role()`/`myClientId()` reading from it (the doc's `orgId` comes from `resource.data.orgId`). This costs one extra read per operation (~$0.06/100k — noise per BUSINESS_MODEL §4) and is preferred over custom claims, which fit a *single*-org design but go stale and can overflow the 1,000-byte claim limit for multi-org editors. The audit-hardened role logic stays as-is, now evaluated per org. Extend `firebase/rules-test/firestore.rules.test.mjs` with cross-org denials for every collection **plus the dual-membership cases**: contractor-in-A must not read B's tasks even while being a manager in B, and role in one org must never leak into another.

**App changes.**
- `stores/auth.ts`: after sign-in, load the user's memberships (collection-group query on `members` where `uid == mine` — needs a collection-group index + a rule allowing users to read their own membership docs). Expose `memberships`, `activeOrgId` (persisted to localStorage; auto-selected when there's exactly one), and `role`/`isManager`/`clientId` computed **from the active membership**. `homeRoute()` already keys off `role`, so it works per-org unchanged.
- **Org switcher** in `AppShell` (visible only with >1 membership): switching calls `dataStore.reset()` + sets `activeOrgId` + redirects to `homeRoute()` — the same clean-slate path as logout, reusing the audit's no-data-bleed guarantee.
- `stores/data.ts`: every `getDocs`/`addDoc` gains `where('orgId','==', auth.activeOrgId)` / `orgId` on the payload. **Do the pagination fix here** (`limit()` + `startAfter` on `loadAllTasks`/`loadAllProjects`; the store already replaces state on full loads, so cursors slot in cleanly). Composite indexes: `(orgId, status)`, `(orgId, assigneeUid)`, `(orgId, clientId)`, `(orgId, completedAt)` → `firebase/firestore.indexes.json` (new file, wire into `firebase.json`).
- **Self-serve signup** (new — the app is invite-only today): a "Create workspace" flow on `LoginPage` (name + email/password or Google) that calls a Cloud Function `createOrg` (creates org doc + owner membership, `plan: 'free'`). Existing invite-only flow becomes the *in-org* invite: `orgs/{orgId}/invites/{inviteId}` docs (email, role, expiry) created from `TeamPage`, accepted via an `/invite/:id` public route. **If the invited email already has an account, accepting just creates the membership** — this is exactly the multi-studio contractor path; new emails go through signup (+ the existing email-verification gate) first.
- `firebase/functions/seed.mjs`: seed **two** demo orgs with one contractor who belongs to both (the multi-org scenario stays permanently testable), stamp `orgId` everywhere.

**Definition of done:** two seeded orgs sharing one contractor; every rules test passes including cross-org and dual-membership denials; a fresh visitor can create a workspace, invite an *existing* contractor (who gains a second org without a second account) and a client user; the contractor can switch orgs and sees zero bleed between them.

## Phase 1 — Billing engine (Stripe) ✅ IMPLEMENTED 2026-07-10

> Shipped: config/checkout/portal/webhook routes (env-driven, OFF by default — 503 + `enabled:false` without keys), idempotent webhook writing the org billing block, seat-quantity sync on invite accept/member removal, Settings billing card with live plan state. Setup steps in README "Billing (Stripe)".

**Stripe objects.** Products: Studio, Agency. Prices: monthly + annual for each, `licensed` per-seat quantity. Free tier is the absence of a subscription. Tax: Stripe Tax on; invoices + dunning handled by Stripe.

**Cloud Functions** (extend `firebase/functions/src/api.ts`; it currently serves only `/health` and is unauthenticated — add ID-token verification middleware first, flagged in AUDIT S11):
- `POST /billing/checkout` — creates a Checkout Session (plan, interval, quantity = current seat count from `usage/current`), `success_url`/`cancel_url` back to Settings. Manager-only.
- `POST /billing/portal` — Stripe Customer Portal session (payment method, invoices, cancel). Manager-only.
- `POST /billing/webhook` — verified via Stripe signature (raw body — mount before any JSON parser). Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` → writes the org's billing block (`plan`, limits from a single `PLAN_LIMITS` map shared as a constants module, `subscriptionStatus`, `currentPeriodEnd`). **The webhook is the only writer of billing fields** — rules make them client-read-only.
- Seat sync: on team invite/role change, a Function updates the Stripe subscription quantity (proration on upgrade; decrement at period end). Simplest correct policy: quantity = current seats, updated at invite-accept and member-removal.

**Grace behavior:** `payment_failed`/`past_due` → banner + 14-day grace, then auto-downgrade to Free limits (data is never deleted; over-limit workspaces become read-only for creates — see Phase 2 semantics).

**Local dev:** Stripe test mode + `stripe listen --forward-to localhost:5001/.../billing/webhook`; secrets via Functions env (`.env` for emulators, Secret Manager in prod). Document in README's dev workflow.

**Definition of done:** test-mode checkout upgrades a live emulator org to Studio in <5 s via webhook; cancel in the portal downgrades it at period end; webhook replay is idempotent (store processed `event.id`s).

## Phase 2 — Entitlement enforcement ✅ IMPLEMENTED 2026-07-10

> Shipped: usage counters (clients/tasks in-batch with creates/cascades; seats server-side), rules limit gates on client/task/invite creation, seat re-check at invite accept (409), `useEntitlements` + `UpsellModal`, feature gates (ledger/analytics/import/CSV export) in router+nav+pages, usage bars in Settings. Deviation from spec: counter increment *values* aren't rules-validated (managers-only writes + future reconciliation — documented in rules comments); the nightly reconciliation Function shipped later the same day (`reconcileUsage` in `functions/src/index.ts` + `POST /orgs/:orgId/reconcile`).

Two layers, mirroring the existing role-gating architecture (UI convenience + rules as truth):

**Server-side (rules).** Gates compare the `usage/current` counters against the org's limits: task/client/seat creates are allowed only when `usage.activeTasks < org.taskLimit` etc. Counter integrity: creates/deletes in `stores/data.ts` become transactions that increment/decrement the counter in the same commit, and rules validate the counter write matches the mutation (+1 on create, −1 on delete). A nightly reconciliation Function recounts and heals drift. Plan-flag gates (ledger export, analytics, import) are checked in rules where they touch data and in the UI everywhere.
**Over-limit semantics on downgrade:** never delete or hide data — block *new* creates only, with the upsell explaining why.

**Client-side.** New `composables/useEntitlements.ts`: subscribes to the org doc + usage doc, exposes `plan`, `limits`, `usage`, `canCreateTask/Client/Seat`, `has('ledger' | 'analytics' | 'import')`, `nearLimit(pct)`. Consumed by:
- `router/index.ts`: `meta.plan: 'studio'` on `/ledger`, `/analytics` — same pattern as `meta.roles` (redirect to Settings#billing with an upsell toast instead of `homeRoute`).
- Create buttons/modals (`DashboardPage`, `ClientDetailPage`, `ProjectBoardPage`, `TeamPage`): disabled state + upsell modal at limit; a soft "8 of 10 clients used" hint from `nearLimit(0.8)` (this is the conversion moment — instrument it).
- `SettingsPage`: new Billing card (current plan, usage bars vs limits, Upgrade → checkout, Manage → portal).
- i18n: new `locales/pages/billing.ts` module, en + es, per the non-negotiable i18n rules; upsell strings parameterized by gate (`billing.gateClients`, `billing.gateTasks`, `billing.gateSeats`, `billing.gateFeature`).

**Definition of done:** rules tests prove an at-limit Free org cannot create a 4th client even with a hand-crafted request; UI shows the upsell instead of a permission error; upgrading in test mode immediately unblocks creation without reload (org doc is a live subscription).

## Phase 3 — Pricing page & upgrade UX ✅ IMPLEMENTED 2026-07-10

> Shipped: public `/pricing` (4 tiers, interval toggle, `?reason=` gate banner, FAQ, role-aware CTAs incl. in-page checkout for free-plan managers), links from login/Settings/upsell. Deviation: prices/limits on the public page come from app-side constants mirroring `functions/src/plans.ts` (the auth-gated config endpoint can't serve signed-out visitors) — keep in sync. `SALES_MAILTO` is a placeholder to replace.

- **Public `/pricing` route** (`meta.public: true`, like `/login`): four tier cards from a single typed `PLANS` constant (shared with `PLAN_LIMITS` so the page can never drift from enforcement), monthly/annual toggle (reuse `SegmentedControl`), highlighted recommended tier, FAQ block (client users free, what counts as an active client/task, cancellation). Fully i18n'd; CTA = "Start free" → signup, or "Upgrade" → checkout when signed in. Add a nav link on `LoginPage` and in the logged-out footer.
- **Upgrade paths:** every gate upsell deep-links to `/pricing` with the triggering gate pre-highlighted (`?reason=clients`); Settings Billing card is the persistent entry point.
- **Transactional comms** (Stripe-native): receipts, payment-failure dunning emails, upcoming-renewal for annual. No custom email infra in MVP.
- **View transitions:** pricing page follows the standard Recipe 1 cross-fade; no bespoke animation work (rules in `docs/animations.md` apply).

**Definition of done:** a signed-out visitor can go pricing → signup → workspace → hit the 3-client gate → upgrade → pay (test card) → unblocked, in one sitting, in both locales.

## Phase 4 — Instrumentation & launch ✅ IMPLEMENTED 2026-07-10 (except launch-day items)

> Shipped: env-gated PostHog wrapper (`lib/analytics.ts`, dormant without `VITE_POSTHOG_KEY`; DEV logs to console) with the full funnel event set (signup → workspace_created → gate_hit/upsell_viewed → checkout_started/completed, plus invite/org-switch/create events — uids and org ids only, never PII); nightly `reconcileUsage` scheduled function + `POST /orgs/:orgId/reconcile` (manager, dev/support trigger) healing counter drift via aggregate count() queries; "Leave workspace" in Settings (non-owners); document titles on login/pricing/settings.
>
> Remaining for launch day: PostHog account + key, Stripe live keys + webhook secret in Secret Manager, replace `SALES_MAILTO`, run rules tests + real functions build, BigQuery billing export, refund/cancellation policy page.

- **Product analytics** (PostHog or Amplitude, self-serve tier): events `workspace_created`, `activated` (first client+project+invite, per BUSINESS_MODEL §7), `gate_hit {gate, plan}`, `upsell_viewed`, `checkout_started`, `checkout_completed`, `subscription_cancelled`. The gate→checkout funnel is the pricing-tuning instrument.
- **Cost watch:** BigQuery billing export; reads-per-org is approximable from usage counters + session counts until Firestore per-label billing is worth wiring. Alert at >$5/mo/org (pre-media threshold from BUSINESS_MODEL §7.5).
- **Launch checklist:** rules tests green (incl. cross-org + entitlements), Stripe live keys + webhook secret in Secret Manager, price IDs env-switched (test/live), `/pricing` indexed (meta tags), README updated, seed script creates a Free demo org, grace-period banner tested, refund/cancellation policy page linked from checkout.

## Decision log & open questions

- **Stripe** over Paddle/LemonSqueezy: best Checkout/Portal/Tax tooling; revisit only if merchant-of-record (VAT handling) becomes a burden — Paddle is the fallback and the abstraction point is the three billing Functions.
- **Membership docs (`orgs/{orgId}/members/{uid}`) over custom claims** for org/role: multi-org contractors are a first-class scenario, and claims go stale across N orgs and can overflow the 1,000-byte limit. The cost is one extra rule read per operation (economically noise); the win is instant role changes, unbounded memberships, and per-org roles for the same account.
- **Seats are per-org**: a contractor in two orgs is a billable seat in each (Slack/Notion precedent) — each org receives full value; no cross-org seat sharing in the pricing.
- **Annual discount ~17%** (2 months free) per BUSINESS_MODEL; annual-only for Enterprise.
- Open: trial of Studio features on signup (14-day full-featured trial converts 2–3× better than pure freemium for sales-light B2B — worth an A/B once instrumentation exists); whether contractor seats price lower than manager seats (defer; adds checkout complexity for unproven demand).
