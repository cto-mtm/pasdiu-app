# Pasdiu — Deep Audit Report

**Date:** 2026-07-09 · **Scope:** full repo (`app/src`, `firebase/`) · **Mode:** read-only; no code changed.

---

## ✅ Remediation status (updated 2026-07-09, same day)

**Every finding below has been fixed**, except the items listed here.

**Needs your action:**

- **Rules tests** (20 cases, `firebase/rules-test/`) are written but couldn't run in the sandbox (the Firestore emulator jar download is network-blocked). Run: `cd firebase && npm i -D @firebase/rules-unit-testing firebase && firebase emulators:exec --only firestore --project demo-app "npm test"`.
- `firebase/functions/lib/` was hand-patched to match the `/echo` removal (the emulator loads it without rebuilding); rebuild functions when convenient.
- Re-run `npm run seed` if your emulator data predates the rules change — behavior is otherwise unchanged for the seeded flows.

**Kept by design (documented in rules comments):** user-profile reads for all signed-in users (names shown app-wide); contractor broad reads (board UI needs them) — S5/S6.

**Deferred (features, not fixes):** query pagination/limits (E3); Firebase Storage upload for version media — `mediaUrl` now *renders* when present (F1); an un-approve flow for clients.

**Not audit items, untouched:** 4 pre-existing ESLint errors (`vue/multi-word-component-names` on Breadcrumbs/Modal/Toaster, the standard vue-i18n empty-interface augmentation) and the repo-wide formatting-warning baseline.

**Behavior changes to be aware of:** user-doc writes are now manager-only; contractors can only change status on tasks assigned to them and can never set `approved`; clients can only set `approved`; notes are editable/resolvable only by their author or managers; logout clears all client state; a login without a `users/{uid}` profile is signed out with an error message; seed quick-login buttons render in dev builds only.

Every file in `app/src` (15 pages, 18 components, 3 stores, lib, router, all 21 locale modules, both CSS files), `firebase/functions/src`, `seed.mjs`, `firestore.rules`, and the rules tests was read. High-severity findings were independently re-verified against source.

**Verdict in one line:** the architecture is disciplined (store gateway, i18n parity, router-only view transitions are all fully compliant), but the Firestore rules have real privilege-escalation holes, logout leaks data across accounts, and there's a consistent layer of duplication that ~6 small helpers/components would eliminate.

---

## 1. Security (highest priority)

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| S1 | **HIGH** | **Self-role escalation.** Any signed-in user can write their own `users/{uid}` doc with no field restrictions — set `role: 'admin'` or repoint `clientId`, gaining manager access to everything (all other rules derive from this doc). The app never legitimately self-writes this doc. | `firestore.rules:27` |
| S2 | **HIGH** | **Unconstrained task updates.** The assigned contractor or owning client may update *any* field: reassign, move across tenants, self-approve. UI only ever sets `status`/`completedAt`; the rule should validate `affectedKeys().hasOnly(['status','completedAt'])` per role. | `firestore.rules:53-55` |
| S3 | **HIGH** | **Notes: cross-tenant read/write.** `allow read, write: if signedIn()` — any user can read, edit, or delete feedback notes under any tenant's task; `authorUid` is client-supplied and spoofable. Subcollection rules don't inherit parent access — needs a `get()` check on the parent task. | `firestore.rules:63-66`, `data.ts:356-360` |
| S4 | **HIGH** | **Versions: same hole.** Any user reads all versions; any contractor writes versions on any task, not just assigned ones. | `firestore.rules:58-61` |
| S5 | MED | All user profiles (email/role/clientId) readable by every signed-in user, incl. clients. | `firestore.rules:26` |
| S6 | MED | Contractors can query all tenants' clients/projects/tasks — router gating is UI-only. | `firestore.rules:32,38,44,51` |
| S7 | MED | No schema validation in rules (no type/enum/required-key checks on any write). | whole file |
| S8 | MED | Rules test suite covers 3 cases; none of S1–S4's deny paths are tested. | `rules-test/firestore.rules.test.mjs` |
| S9 | MED | Seed credentials + one-click login buttons ship in prod builds (not gated by `import.meta.env.DEV`). | `LoginPage.vue:17-24` |
| S10 | LOW | CSV export doesn't neutralize leading `=+-@` → formula injection in Excel/Sheets. | `LedgerPage.vue:51-61` |
| S11 | LOW | Cloud Functions API has no ID-token verification (only `/health` matters today). | `functions/src/api.ts` |

## 2. Auth & data-lifecycle gaps

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| A1 | **HIGH** | **Cross-account data bleed on logout.** `logout()` never resets the data store (no `$reset` anywhere). Admin signs out → client signs in same tab → the portal computes from the still-populated store and shows *every* client's projects/tasks. Verified. | `auth.ts:87-91` |
| A2 | MED | Missing `users/{uid}` doc silently defaults role to `contractor` → broken slate with fake-empty state. | `auth.ts:52` |
| A3 | MED | Profile `onSnapshot` error callback just `resolve()`s → authed user bounced to /login with no feedback. | `auth.ts:57` |
| A4 | LOW | Live role change (demotion) doesn't re-run the route guard until next navigation. | `router/index.ts:46-66` |

## 3. Error handling & integrity

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| E1 | MED | No page `onMounted` loader has a catch: failed reads → eternal "Loading…" or misleading empty states. No not-found state for deleted/foreign task ids. | all 10 pages, e.g. `IterationRoomPage.vue:119-128` |
| E2 | MED | `busy` flags without `try/finally` in 6 handlers — one failed write permanently disables the modal button (`guarded()` rethrows). `saveProject` does it right; the rest don't. | `ProjectBoardPage.vue:87-121`, `DashboardPage.vue:20-27`, `ClientDetailPage.vue:29-37`, `TeamMemberPage.vue:43-49`, `BriefDrawer.vue:35-47` |
| E3 | LOW | Unbounded queries everywhere (`loadAllTasks` etc.) — fine seeded, no limits/pagination for production. | `data.ts:77-187` |
| E4 | LOW | Version label `v${count+1}` races (duplicate v2s) and `localeCompare` sort puts v10 before v2. | `data.ts:343,365-372` |
| E5 | LOW | Cascade deletes are sequential, non-atomic; mid-flight failure orphans notes/versions. | `data.ts:282-336` |
| E6 | LOW | `useApi` has a stale-response race; no abort/timeout. `SlatePage` sorts null `dueAt` as most-urgent. Upsert-only cache keeps ghost docs until reload. | `useApi.ts:13-23`, `SlatePage.vue:17` |

## 4. Functional gaps (incomplete features)

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| F1 | MED | **Version media is a permanent placeholder.** README promises a media pane; `mediaUrl` exists in types + seed but `addVersion` always writes `''`, nothing renders it, no Storage integration. | `IterationRoomPage.vue:193-206`, `data.ts:368-371` |
| F2 | MED | Team editor can assign `client` role but there's no `clientId` picker → broken user with empty portal. | `TeamMemberPage.vue:18,136-141` |
| F3 | LOW | TaskCard status select lets a contractor pick "approved" (client-only per README) and shows enabled on unassigned tasks (fails at rules → toast). | `TaskCard.vue:91-100` |
| F4 | LOW | `/about` route unreachable from any nav. `POST /echo` endpoint never called by the app. | `router/index.ts:34`, `functions/src/api.ts:41-45` |
| F5 | LOW | ImportWizard `ensureSubGroup` dedupes against local cache only → duplicate "Imported" groups; row failures give one generic error. | `ImportWizard.vue:146-151,184` |

No TODO/FIXME markers exist. Omni-search, brief drawer, CSV export, kanban/list boards verified fully wired end-to-end.

## 5. Project-rule compliance

**Fully compliant:** store discipline (zero direct SDK usage outside `lib/firebase.ts` + stores), locale parity (`es: typeof en` enforced, all 21 modules registered in both), `document.startViewTransition` only in the router wrapper with correct reduced-motion + feature-detection fallbacks, unique id-derived `view-transition-name`s.

### i18n leaks

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| I1 | HIGH | `aria-label="Close"` hardcoded in the shared Modal (ships on ~10 pages, both locales). | `Modal.vue:69` |
| I2 | HIGH | CSV export headers hardcoded English (`['Task','Client',…]`) while translated `ledger.col*` keys exist and are used in the same file; raw status values exported too. | `LedgerPage.vue:52` |
| I3 | MED | `api.ts` error strings (`Request failed (…)`, `Network error`) rendered verbatim on AboutPage. | `api.ts:37,43` |
| I4 | MED | Fallback sub-group name `'Imported'` and fallback display name `'User'` hardcoded. | `ImportWizard.vue:132`, `auth.ts:51` |
| I5 | LOW | `alt="Pasdiu"` (key exists); literal `esc` kbd text; three unlabeled `✕` buttons (Toaster, BriefDrawer, ImportWizard) vs MetaEditor's correct pattern. | various |

### Animation-rule violations

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| N1 | MED | Recipe 5 animates `box-shadow` — violates the transform/opacity-only rule stated in the same file's header. | `transitions.css:77-84` |
| N2 | MED | BarChart animates `width` @500ms; DonutChart animates `stroke-dasharray` @500ms — wrong property and over the 350ms cap (both do have reduced-motion fallbacks). | `BarChart.vue:40-42`, `DonutChart.vue:82-84` |
| N3 | MED | AppShell sidebar `transition-all` animates width; no reduced-motion gate. TaskCard also uses `transition-all`. | `AppShell.vue:78`, `TaskCard.vue:61,77` |
| N4 | MED | ImportWizard's modal transition duplicates Modal's CSS and is the only overlay with **no** reduced-motion block; 180ms is under the 200ms floor. | `ImportWizard.vue:300-305` |
| N5 | LOW | Sub-200ms durations: Modal fade 180ms, OmniSearch 160/180ms, InfoTip 150ms; Tailwind `transition-colors` defaults (150ms) used throughout. | various |
| N6 | LOW | Scoped transition CSS lives in 8 components despite the "all transition CSS in transitions.css" rule — worth resolving the rule vs. docs ambiguity explicitly. | Modal, Toaster, OmniSearch, BriefDrawer, InfoTip, ImportWizard, charts |
| N7 | LOW | Stale docs: `transitions.css:21-22` + `docs/animations.md` reference `item-<id>`/`HomePage`, which don't exist (real names: `client-title-<id>`, `about-page`). | docs |

## 6. Dead code

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| X1 | MED | `useReducedMotion()` composable never imported anywhere (verified). | `composables/useReducedMotion.ts` |
| X2 | MED | `zod` in app deps, zero imports (verified). `@capacitor/keyboard` + `@capacitor/status-bar` never imported, no plugin config. | `app/package.json:20-27` |
| X3 | LOW | Unused i18n keys: `common.back`, `import.failed`, `actions.colorLabel`. Unused `long` datetime format. | locales, `i18n/index.ts:87,91` |
| X4 | LOW | `auth.loading` set/exported, never read. `ApiResult`, `firebaseApp` exported, used only internally. | `auth.ts:31`, `api.ts:13`, `firebase.ts:15` |
| X5 | LOW | `EchoBody` type never imported; `/echo` route uncalled. `firebase-admin` is a runtime dep of functions but only `seed.mjs` uses it (ships in every deploy). | `functions/src/models.ts:12`, `functions/package.json:14` |
| X6 | LOW | `.safe-left/.safe-right` CSS unused; `about-root` class matches no selector; BrandLogo `variant="black"` branch + `logo-black.svg` never exercised; `Version.mediaUrl` written but never read (see F1). | various |

All transitions.css recipes, all components/pages, all `.env.example` vars: verified live.

## 7. DRY & modularity

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| R1 | HIGH | `status === 'done' \|\| status === 'approved'` (or negation) hand-rolled 8× across store, TaskCard, Slate, Analytics, Team, TeamMember, Ledger, seed. | `isDoneStatus()` in `lib/status.ts` |
| R2 | HIGH | `filter(u => u.role === 'contractor')` duplicated 5×. | `contractors` getter on data store |
| R3 | HIGH | `loadUsers+loadClients+loadAllProjects+loadAllTasks` bootstrap repeated 6×. | one `loadWorkspace()` action |
| R4 | HIGH | Identical form-control class+style pair ~25× across 8 files; `BaseButton` exists but the pattern stopped there. | `BaseInput`/`BaseSelect` |
| R5 | MED | TaskCard hand-rolls a confirm modal identical to the existing `ConfirmDialog.vue`; ImportWizard hand-rolls its own modal shell, losing Modal's focus trap. | reuse the primitives |
| R6 | MED | Task list-row (link + context + due + badge) near-identical in AllTasks, TeamMember (×2), ClientPortal, incl. duplicated `context()` helper. | shared `TaskRow.vue` |
| R7 | MED | Modal footer (cancel + submit) duplicated ~10×; edit-modal open/copy/trim/save boilerplate ×4. | `ModalFooter` slot component; `useEditForm` composable |
| R8 | MED | Seed credentials duplicated between `LoginPage.vue` and `seed.mjs` — silent drift breaks quick login. | shared constants |
| R9 | MED | `data.ts` (388 lines) mixes converters, error plumbing, CRUD ×4 domains, cascade deletes. Converter style drifts within the file (module-scope vs inline). | extract converters + cascade logic to `lib/`, store stays the reactive facade |
| R10 | MED | Inconsistent caching (`loadUsers` memoizes, `loadClients` doesn't → pages compensate ad hoc). IterationRoom keeps a local `task` copy manually re-patched after saves — two sources of truth. | one cache policy; `computed(() => data.getTask(id))` |
| R11 | LOW | CSV writing hand-rolled in Ledger while `lib/csv.ts` only parses; kanban/grid segmented toggle duplicated; `logout()`+redirect duplicated; `ROLES` array re-declared vs `lib/types.ts`; `client-title-` magic string ×3; `lib/status.ts` mixes raw hexes with CSS vars. | small extractions |

---

## Recommended fix order

1. **Rules lockdown** — S1 (self-write), S2 (task field whitelist), S3/S4 (parent-task `get()` checks) + tests for each deny path (S8). This is the only cluster with real exploit value.
2. **`dataStore.$reset()` on logout** (A1) and auth edge states (A2/A3).
3. **`try/finally` on all busy flags** (E2) + page-load error/not-found states (E1).
4. **DRY pass** — R1–R4 are ~2 hours of work and eliminate the bulk of the duplication; then R5–R7.
5. **i18n leaks** I1/I2, dead-code removals X1–X3, animation property fixes N1–N3.
6. Product decisions needed: F1 (media upload vs drop the field), F2 (client picker), S6 (contractor data scope).
