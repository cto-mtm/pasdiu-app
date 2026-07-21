# Pasdiu

A local-first web app scaffold that runs in the browser today and ships as an iOS/Android app via Capacitor with zero restructuring.

## What's in the box

- **`shared/`** — Monorepo shared package (`@pasdiu/shared`) holding domain models, plan constants, and Zod validation schemas.
- **`app/`** — Vue 3 + Vite + TypeScript SPA, wrapped by Capacitor for iOS/Android.
- **`firebase/`** — Firebase Hosting config + Cloud Functions API (inlined via `esbuild`), plus Emulator Suite scripts for full offline local dev.
- **Animation system** — page/hero/shared-element transitions built on the native View Transitions API (no animation library). See `docs/animations.md`.
- **vue-i18n** — wired in from day one, `en` (source of truth) + `es` (fallback), type-safe key parity. See `docs/i18n.md`.

## Quick start — fully local, no Firebase account

The emulators run under the `demo-app` project id. Any id prefixed `demo-` makes the Emulator Suite run **fully offline** — it never reaches real Firebase resources and needs no `firebase login`. So this works on a fresh machine with the `REPLACE_ME` `.firebaserc` untouched.

```bash
# 0. one-time: global CLI
npm i -g firebase-tools

# 1. install + build the shared package and functions
npm install
npm run build:shared
npm run build:functions

# 2. start the emulated backend (Auth :9099, Functions :5001, Firestore :8080)
cd firebase && npm run emulators

# 3. in a THIRD terminal (leave emulators running): seed demo data
cd firebase && npm run seed

# 4. in a SECOND terminal: run the web app (already pointed at the emulators)
cd app && cp .env.example .env && npm run dev
```

Open `http://localhost:5173` and sign in. The seed script creates **two demo
workspaces (orgs)** — *Pasdiu Studio* and *Northlight Post* — and demo
accounts (password `pasdiu123`), each landing on its role's experience:

| Email | Role | Lands on |
| --- | --- | --- |
| `admin@pasdiu.test` | Admin (Pasdiu Studio) | Dashboard (clients, boards, ledger) |
| `pm@pasdiu.test` | Project Manager (Pasdiu Studio) | Dashboard |
| `editor@pasdiu.test` | Editor / contractor — member of **both** workspaces | Focus Slate (assigned tasks) |
| `client@pasdiu.test` | Client (Pasdiu Studio) | Portal (review & approve) |
| `north@pasdiu.test` | Admin (Northlight Post) | Dashboard |

`editor@pasdiu.test` belongs to BOTH workspaces (contractor in each) — use it
to demo the org switcher and multi-org membership.

Invites work in *Pasdiu Studio* (seeded on the paid **Studio** plan, so it has
seat room); *Northlight Post* is deliberately at its Free-plan seat limit to
demo the seat gate + upsell.

The login screen has one-click buttons for each. The Settings page runs the
Cloud Function `/health` check to prove the app→function path.

### Sign-in options

- **Email + password** with a **forgot-password** flow (reset link via email).
- **Google sign-in** — in local dev the Auth emulator shows a fake account
  picker, no real Google account needed. In production, enable the Google
  provider in Firebase Console → Authentication → Sign-in method.
- **Self-serve workspaces + invites**: signing up (email/password or Google)
  with no workspace lands on `/welcome` to create one; joining an existing
  workspace happens via invite links (`/invite/:orgId/:inviteId`) that managers
  create from the Team page. One account can belong to many workspaces (the
  sidebar shows an org switcher).
- **Email verification is enforced**: unverified accounts get a verification
  link and are signed out until they confirm. Seeded demo users are
  pre-verified. In local dev the emulator doesn't send real mail — password
  reset and verification links are printed in the **emulator terminal log**
  (and visible in the Emulator Suite UI at `http://localhost:4000/auth`).
- Native (Capacitor) builds: `signInWithPopup` is web-only; wire
  `@capacitor-firebase/authentication` before shipping Google sign-in on
  iOS/Android.

## What the app does

- **Deep nesting**: Client → Project → Sub-Group → Task, with breadcrumbs and a persistent omni-search (managers) over clients/projects/tasks.
- **Boards**: each project toggles between a Kanban view (columns by status) and a linear List view (grouped by sub-group), with a tactile check-off micro-animation.
- **Iteration Room** (`/tasks/:id`): split-screen media pane + a version timeline (v1/v2/v3) with threaded feedback notes; clients can approve.
- **Project Brief Drawer**: a slide-over holding brand guidelines, SOPs, and links, reachable from any board or task.
- **Export Ledger**: completed work with contractor + timestamps and one-click CSV export.
- **Role-based landing**: the router reads the signed-in user's Firestore role and routes to the Dashboard, Slate, or Portal accordingly.

Data lives in Firestore (Pinia holds the reactive client-side state); auth is
Firebase Auth. Both run in the emulators locally. Firestore rules are in
`firebase/firestore.rules`.

### Daily workflow (two terminals)

- Terminal A — `firebase/functions/`: `npm run build:watch` (esbuild re-bundles on save).
- Terminal B — `firebase/`: `npm run emulators:watch` (hot-reloads functions when `lib/` changes).
- Terminal C — `app/`: `npm run dev`.

`npm run emulators:all` (in `firebase/`) additionally serves the built app from `firebase/app/` on :5000 for a production-like smoke test; day-to-day dev uses Vite on :5173.

## How to add a hero (shared-element) transition

Full recipe in `docs/animations.md`. In short:

1. On the **source** element (e.g. a card block), set `:style="{ viewTransitionName: 'item-' + item.id }"`.
2. On the **target** element on the next page, set the **same** name.
3. Navigate through the router — the View Transitions wrapper snapshots both pages and the browser morphs the matched element automatically.

Names must be unique per page at any moment — always derive them from the item id, never a static string in a `v-for`. The reference implementation is the `DashboardPage` client card → `ClientDetailPage` header (`client-title-<id>`).

## How to add a translated string / a new locale

See `docs/i18n.md`. Every user-facing string is a key in a per-feature module under `src/i18n/locales/**`. Add the key to **both** `en` and `es` in the same edit — `es: typeof en` makes a divergence a compile error. Use `t()` from `useI18n()` in components; never a hardcoded string.

## How to add an API endpoint

1. Add a route branch in `firebase/functions/src/api.ts`. If the route takes a
   body, validate it with a Zod schema from `@pasdiu/shared` (e.g. `shared/src/schemas/`)
   and parse the body before trusting it.
2. Call it from the app via `apiFetch('/your-route', ...)` in `src/lib/api.ts`.

It's testable immediately against the emulator — no deploy needed.

It's testable immediately against the emulator — no deploy needed.

## Billing (Stripe)

Billing is optional and OFF by default — with no Stripe env vars the API
reports `enabled: false` from `GET /billing/config` and the billing routes
return 503. To develop against Stripe **test mode**:

1. In the Stripe Dashboard (test mode) create two products — **Studio** and
   **Agency** — each with a **monthly** and an **annual** per-seat (licensed)
   recurring price. Suggested amounts: Studio $12/mo or $120/yr per seat;
   Agency $25/mo or $252/yr per seat (the UI displays $10 and $21 per-seat/mo
   for annual).
2. `cp firebase/functions/.env.example firebase/functions/.env` and fill in
   `STRIPE_SECRET_KEY` plus the four `STRIPE_PRICE_*` price IDs.
   firebase-functions v2 loads `functions/.env` automatically — restart the
   emulators after editing it.
3. Forward webhooks to the emulated function with the Stripe CLI:

   ```bash
   stripe listen --forward-to http://localhost:5001/demo-app/us-central1/api/billing/webhook
   ```

   Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` in
   `functions/.env` (and restart the emulators once more).
4. Upgrade flow: `POST /billing/checkout` (manager-only) returns a Checkout
   URL; paying with a test card (`4242 4242 4242 4242`) fires
   `checkout.session.completed`, and the webhook writes the org's billing
   block (`plan`, limits, `subscriptionStatus`, `currentPeriodEnd`).
   `POST /billing/portal` opens the Stripe customer portal (invoices,
   payment method, cancel). Webhook replays are idempotent via
   `billingEvents/{eventId}` marker docs (functions-only collection).

In production put `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in Secret
Manager, set the live price IDs + `APP_URL`, and point a Stripe webhook
endpoint at `https://us-central1-<project>.cloudfunctions.net/api/billing/webhook`.

### Usage reconciliation

The entitlement gates read the `orgs/{orgId}/usage/current` counters, whose
client-written increments aren't value-validated by rules — so drift is
possible and reconciliation is the healer. In production the scheduled
`reconcileUsage` function recounts every org nightly (aggregate `count()`
queries, no document reads) and corrects `seats`/`activeClients`/`activeTasks`.
The emulator never fires schedules: in dev (and as a support tool) run the
same logic on demand with `POST /orgs/:orgId/reconcile` (manager-only), which
returns `{ orgId, healed, before, after }`.

## Invite emails

Invite emails use the **Trigger Email from Firestore** extension pattern — app
code never calls a mail API:

1. A manager creates an invite from the Team page (a rules-gated Firestore
   write that records the inviter's UI locale).
2. The `onInviteCreated` function renders a localized (en/es) email and queues
   it as a doc in the `mail` collection (deterministic id
   `invite-{orgId}-{inviteId}`, so retriggers can't double-send). `APP_URL`
   (functions `.env`) drives the invite link's host.
3. In production, the [firestore-send-email](https://extensions.dev/extensions/firebase/firestore-send-email)
   extension watches `mail` and delivers over SMTP. `mail` has **no** rules
   match block — default deny means clients can never queue email.

**Prod setup**: `firebase ext:install firebase/firestore-send-email` (or
deploy the `extensions` block in `firebase/firebase.json`) and fill in
`firebase/extensions/firestore-send-email.env` — an SMTP connection URI (e.g.
Resend, SES, or Gmail), collection `mail`, and a from address.

**Dev**: no SMTP needed. The trigger runs whenever the functions emulator is
up, and the queued `mail` docs are simply inspectable in the Emulator Suite UI
(`http://localhost:4000/firestore`) — the integration tests assert on them the
same way (`functions/test/mail.test.ts`).

## Going native

```bash
cd app
npm run build
npx cap add ios && npx cap add android   # one-time
# drop icon.png (1024²) + splash.png (2732²) into app/assets/, then:
npm run cap:assets
npx cap sync
npx cap open ios      # or: npx cap open android
```

The API CORS allow-list already includes the Capacitor origins (`capacitor://localhost`, `http://localhost`), and the Android hardware/gesture back button is already handled in `src/lib/native.ts`.

## Deploy

1. Set the real project id in `.firebaserc`.
2. Set `VITE_API_URL` for prod in `app/.env` (e.g. `https://us-central1-<project>.cloudfunctions.net/api`). Without it the build falls back to the `PROD_FALLBACK` constant in `app/src/lib/api.ts`, which still contains a `REPLACE_ME` project id — the deploy scripts do not catch this, so a prod build shipped without `VITE_API_URL` has a dead API.
3. Run `./scripts/deploy.sh` — the one true deploy path (build → stage `dist/` into `firebase/app/` → `firebase deploy`).

## Security rules & testing

Rules live in `firebase/firestore.rules` (role-based, with client-scoping). Because
Firestore rejects a whole query that *could* return unreadable docs, client-role
screens use filtered queries (`where('clientId','==', …)`); managers/contractors
have resource-independent reads.

Test them the documented way — `@firebase/rules-unit-testing` against the emulator:

```bash
cd firebase
npm i -D @firebase/rules-unit-testing firebase
firebase emulators:exec --only firestore --project demo-app "npm test"
```

Note on deletes: Firestore has no cascade — deleting a document does not delete
its subcollections. The app deletes a task's `versions`/`notes` subcollection
docs manually before the task doc (see `deleteTaskDeep` in `stores/data.ts`), per
the [Firebase delete-data guidance](https://firebase.google.com/docs/firestore/manage-data/delete-data).
For very large trees, prefer a trusted-server Cloud Function with the Admin SDK's
`recursiveDelete()`.

## Keeping dependencies fresh

Versions in `package.json` are pinned to the dates this boilerplate was
generated. They're intentionally NOT auto-updated on install — the goal is
that `npm install && npm run dev` always works on day one.

Recommended workflow when starting a new project from this scaffold:

1. `npm install` in both `app/` and `firebase/functions/` and confirm
   `npm run dev` boots cleanly.
2. Commit the scaffold as your baseline (`git commit -m "initial scaffold"`).
3. Run `npm outdated` in each folder to see drift, and `npm audit` for
   security issues.
4. Upgrade deliberately — one major version at a time, testing between each.
   Watch especially for breaking changes in Vite, Capacitor, Tailwind,
   and Firebase Functions (these have all shipped breaking majors in
   the past).
5. After upgrading, re-run `npm run dev`, click through the hero transition
   and the health check in Settings before committing.

Avoid running `npm update` blindly — it will pull breaking majors without
warning and you'll lose the "clean baseline" property.
