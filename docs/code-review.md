# Code Review — Pasdiu

How to review the pending changes. The subject is **the diff**, not the whole
codebase: `git diff` (unstaged) + `git diff --staged` + untracked files
(`git status --porcelain`). If the work spans commits on a branch, use
`git diff main...HEAD`. Start from `git diff --stat` to get the shape, then read
every changed file in full — a diff hunk without its surrounding file lies about
context.

## 1. DRY

- Does the new code duplicate something that already exists? Before accepting a new
  helper, store slice, component, or route handler, grep for a sibling that already
  does it.
- The shared package `@pasdiu/shared` (`shared/src/`) is the single source of truth for
  domain models, **plan constants** (`plans.ts`), and Zod schemas. Redeclaring a plan
  limit, type, or schema in `app` or `firebase/functions` instead of importing it is a
  DRY violation — flag it.
- The `data` store is **one slice per collection** (`app/src/stores/data/*`) over the
  shared `context.ts`. A new action for a collection belongs in that collection's slice —
  a second place that fetches/caches the same collection is duplication.
- Copy-pasted i18n blocks and repeated Tailwind class strings that belong in a shared
  ui helper both count.

## 2. Elegance / simplicity

- Is this the simplest change that solves the problem? Flag detours: new state that
  mirrors existing state, data reshaped multiple times en route, a prop drilled through
  layers the `data` store already crosses.
- Does it read like the surrounding code? Same error-handling idiom, same API
  request/response envelope, same naming and file layout as its neighbors. A correct
  change in a foreign style is a finding.
- Org scoping and workspace switching go through the two helpers in
  `app/src/stores/auth.ts` — `liveDoc()` (member/org/usage subscriptions) and
  `activateOrg()` (the only path that changes the active workspace). A hand-rolled
  subscription or org-switch alongside them is a smell (and § 6 flags it).
- Backend routes should use the established middleware + response helpers — hand-rolled
  auth checks or ad-hoc response shapes are a smell.

## 3. Overengineering

- Abstractions need ≥2 real consumers **in this diff or already in the tree**. A generic
  built for a hypothetical future caller is a finding.
- Premature config objects, factory functions with one instantiation, interfaces with
  one implementation, feature flags nothing toggles.
- **Do NOT flag:** single-function `lib/` files (centralization/testability), or the
  per-collection `data` store slices on top of the shared `context.ts` (the context is
  the DRY layer; the slices are its consumers).

## 4. Dead code & stale files

Check both directions:

- **Introduced by the diff:** exports nothing consumes, props never passed, i18n keys
  never resolved, commented-out blocks, `console.log` leftovers, ownerless TODOs.
- **Orphaned by the diff:** if the change replaces or reroutes something, did the old
  version get deleted? A refactor that leaves the old component, route, store action,
  schema field, or doc paragraph behind is incomplete.

Verify before flagging (grep, don't guess):

1. Pages → filename must appear in `app/src/router/index.ts` (lazy imports).
2. Components → grep the component name across `.vue` files.
3. Store actions / lib functions → grep the name across `app/`.
4. Shared exports (`@pasdiu/shared`) → grep across **both** `app/` and `firebase/functions/`.
5. Docs → if the diff changes behavior a `docs/` file describes (including
   `docs/deliverables/`), it's stale (README.md and CLAUDE.md too).

## 5. Do the tests need to change?

Two test layers: integration tests in `firebase/functions/test/` (vitest + supertest
against the Firestore/Auth emulators) and Firestore rules tests in
`firebase/rules-test/firestore.rules.test.mjs` (`@firebase/rules-unit-testing`). Map each
change to its guard:

| The diff touches… | Then the review requires… |
|---|---|
| A new or changed API route (`firebase/functions/src/`) | Integration tests: **401** unauthenticated, **403** wrong-org / denied-role, and the happy path — every deny path, not just the happy one. Reuse `test/helpers.ts` (`makeUserToken`, `seedOrg` / `seedMember` / `seedClient` / `seedTask` / `seedDeliverable`). |
| `firestore.rules` | `rules-test/firestore.rules.test.mjs` must cover it. **Any rules relaxation is a hard finding.** |
| Plan limits / entitlements (`shared/src/plans.ts`, org-doc plan fields) | The billing suite — and confirm the field is written by a Cloud Function / Stripe webhook, never the client (§ 6). |
| Stripe / billing handlers (`firebase/functions/src/…/stripe*`, `routes/billing.ts`) | The billing suite, using the offline `stripeEnv` / `stripeSignature` helpers (no network). |
| Roles / membership / invites logic | The members / invites / approval suites — role reads/writes must target `orgs/{orgId}/members/{uid}` (§ 6). |
| Entity/schema shapes in `@pasdiu/shared` | Existing integration tests and seed factories still compile and pass (factories validate through the schemas). |
| A compound Firestore query | An entry in `firestore.indexes.json` (the emulator does not enforce indexes — tests pass, prod throws `FAILED_PRECONDITION`). |

Also check the inverse: a test **deleted or weakened** to make the suite pass is a
finding; a test edited to match genuinely-new behavior is fine.

> No e2e (Playwright) suite exists yet — see the e2e boilerplate doc. When one lands, add
> a row here for user-visible flows (board/tasks, deliverables, client portal).

## 6. Guardrails (quick pass, always)

Scan the diff for these — from the CLAUDE.md non-negotiables. Any hit is automatically HIGH:

- Hardcoded user-facing strings (must be i18n keys, in **both** `en` and `es`; `en` is authored).
- A **role** read or written anywhere but the member docs (`orgs/{orgId}/members/{uid}`) —
  never on `users/{uid}` (identity only).
- **Org scoping** changed outside `liveDoc()` / `activateOrg()` in `app/src/stores/auth.ts`
  (a new live doc or a hand-rolled org switch belongs inside those, not alongside).
- A Firestore **write** from a read-only view — writes always go through the `data` store
  or the API; the read-only views (DeliverableDetailPage, CalendarPage, ClientPortalPage,
  PortalDeliverablePage, SchedulePage) may only read via mappers.
- Plan / subscription fields on the **org doc** written from the app instead of a Cloud
  Function / Stripe webhook.
- A `firestore.rules` relaxation without a matching rules test.
- `document.startViewTransition` called outside the router wrapper, or animating anything
  but `transform` / `opacity`.

## Output format

1. **Blocking** — guardrail hits and missing required tests (rules changes especially).
   file:line + what to do.
2. **DRY / simplification / overengineering** — ranked HIGH/MEDIUM/LOW with the suggested
   shape of the fix.
3. **Dead code & stale files/docs** — table: path, status (dead / orphaned / stale doc),
   evidence (the grep that proved it).
4. **Test gaps** — which layer, which file, which cases.
5. **Watch list** — fine today, worth a note (e.g. a second copy that becomes a DRY
   violation on the third).

Keep it concise and actionable. Identify problems and point at the fix — the review is
not the place to rewrite the app.
