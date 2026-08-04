# Architecture

## How the pieces fit together

Vite builds the SPA into `app/dist/`. `scripts/deploy.sh` copies that `dist/` into `firebase/app/`, where Firebase Hosting serves it with an SPA rewrite (`** → /index.html`). The **same** `dist/` is what Capacitor packages into the iOS/Android shells (`webDir: 'dist'`), so the browser build and the native build are byte-identical.

The app talks to a single Cloud Function (`api`) over JSON. That function has a CORS allow-list that includes both the web origins and the Capacitor origins (`capacitor://localhost`, `http://localhost`), so the same API serves web and native without change.

In local dev the function runs in the Firebase Emulator Suite under the offline `demo-app` project id, and the app targets it via `VITE_API_URL` (`http://127.0.0.1:5001/demo-app/us-central1/api`). Because the project id is prefixed `demo-`, the emulator never touches real Firebase resources and needs no login — this is what makes the scaffold runnable on day one.

Navigation animations run through the View Transitions wrapper in `src/router/index.ts`, with automatic degradation to instant navigation on unsupported browsers or under reduced-motion. All user-facing strings flow through vue-i18n.

## Multi-tenancy (organizations & memberships)

The app is multi-workspace. Identity is global; **role is per-membership**:

- `users/{uid}` — global identity only (`displayName`, `email`, `createdAt`). Users may write only their own doc.
- `orgs/{orgId}` — workspace doc: `name`, `ownerUid`, and a **billing block** (`plan`, `seatLimit`/`clientLimit`/`taskLimit`, `subscriptionStatus`, Stripe ids) written ONLY by Cloud Functions.
- `orgs/{orgId}/members/{uid}` — the tenancy source of truth: `role` (+ `clientId` for client-role members) plus denormalized `uid`/`orgId`/`orgName`/`displayName`/`email`. One person can hold different roles in different orgs (a contractor working for several studios). Created/deleted only via the API; managers may edit `role`/`clientId`/`displayName` — never the owner's doc, never their own `role`.
- `orgs/{orgId}/usage/current` — entitlement counters (`seats` functions-only; `activeClients`/`activeTasks` move in the same writeBatch as the docs they count, and rules require the paired increment via `getAfter()`). A nightly `reconcileUsage` scheduled function (and `POST /orgs/:orgId/reconcile`) heals drift.
- `orgs/{orgId}/invites/{inviteId}` — manager-created, seat-gated at create AND re-checked at accept (API 409 `seat_limit`). Status is `pending → accepted | declined | revoked`: **declined** is the invitee refusing, **revoked** is the org withdrawing. Both are recorded rather than deleted, so a manager can tell a refusal from an invitation nobody has opened.

**Joining a workspace is always the invitee's own act.** An invitation is never applied automatically. Earlier builds auto-accepted every pending invite at login, reasoning that the manager had already authorized it — but that conflates two consents: manager authorization means the *workspace* agrees to the user joining, and says nothing about whether the *user* agrees to join it. In practice anyone knowing an address could place that person in their workspace, across several orgs in one sign-in, with no way to refuse. `GET /orgs/my-invites` now only *lists* invitations; `/welcome` renders them with the inviter's name and an explicit accept/decline.
- Every domain doc (`clients`/`projects`/`subGroups`/`tasks`) carries an immutable `orgId`; every query in `stores/data.ts` filters on it; `versions`/`notes` derive access from their parent task.

Client-side, `stores/auth.ts` loads memberships via a collection-group query, keeps a persisted `activeOrgId`, and live-subscribes the active member/org/usage docs (all detached on logout/switch; the data store fully resets on any org change — the RouterView is keyed on `activeOrgId` so pages remount). Zero memberships isn't an error: the router funnels to `/welcome`, which leads with any invitations addressed to the account (accept or decline) and offers workspace creation as the alternative, while `/invite/:orgId/:inviteId` remains reachable as a direct link.

## Billing & entitlements

Stripe is optional and OFF by default (no env keys → `/billing/*` return 503 and the UI hides itself). The shared workspace package (`@pasdiu/shared` in `shared/src/plans.ts` & `shared/src/types.ts`) is the single source of truth for plan limits, pricing display values, domain types, and Zod schemas, imported by both `app/` and `firebase/functions/`. The webhook (`POST /billing/webhook`, signature-verified, idempotent via `billingEvents` markers, 500s on handler failure so Stripe retries) is the only writer of the org billing block. Enforcement is two-layer: `useEntitlements()` + `UpsellModal` pre-empt in the UI (gates fail open while docs load), and Firestore rules are the backstop (limit checks + paired counter increments). Feature flags (ledger/analytics/import/CSV export) gate by plan in `router` meta, nav, and pages.

Analytics (`lib/analytics.ts`) is likewise env-gated (PostHog behind `VITE_POSTHOG_KEY`, console-logged in dev) and carries uids/org ids only — never emails, names, or route params.

## Hosting config notes

- Hosting `public` is `"app"` because the deploy flow copies `app/dist/` into `firebase/app/` before deploying.
- The SPA rewrite (`** → /index.html`) is required because the app uses `createWebHistory` (real URLs, no hash). Without it, deep links like `/settings` 404 on refresh.

## Locale config

Cross-cutting locale config (default locale, `SUPPORTED_LOCALES`, datetime formats) lives in `src/i18n/index.ts` — see `docs/i18n.md` for how strings and locales are added.

## When you need deep links

Opening `https://yourdomain/tasks/abc123` directly into the **native** app (rather than the browser) requires platform deep-link setup:

- **iOS — Universal Links**: host an `apple-app-site-association` file and add the Associated Domains entitlement.
- **Android — App Links**: host an `assetlinks.json` file and add intent filters.

This is deliberately **not** scaffolded — it needs your real domain and signing certificates. The SPA routes (`/clients/:clientId`, `/tasks/:taskId`, etc.) are already shaped to support it. See the official Capacitor deep-links guide: <https://capacitorjs.com/docs/guides/deep-links>.
