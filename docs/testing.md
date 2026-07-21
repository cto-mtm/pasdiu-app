# Testing

Two test layers, both running against the Firebase emulators (project id
`demo-app` — offline-only, no credentials, nothing can touch production).

## Layer 1 — Firestore security-rules tests

What they guard: direct client access to Firestore (`firebase/firestore.rules`)
— tenancy scoping, role gates, entitlement gates, immutable fields.

- Location: `firebase/rules-test/` (`node --test` + `@firebase/rules-unit-testing`)
- Run (one-shot, boots its own emulator):

```bash
cd firebase
firebase emulators:exec --only firestore --project demo-app "npm test"
```

## Layer 2 — Cloud Functions API integration tests

What they guard: the Express API in `firebase/functions/src/api.ts` — real
token verification (`helpers/auth.ts`), real role checks against
`orgs/{orgId}/members/{uid}` docs, real Firestore transactions. Nothing is
mocked: tests drive the **live app in-process** with supertest against the
Firestore + Auth emulators. The one external service, Stripe, is not mocked
either — tests cover exactly what is testable offline (disabled-mode 503s,
pre-Stripe request gates, and webhook handlers that are payload + Firestore
only, signed offline with `stripe.webhooks.generateTestHeaderString`).
`checkout.session.completed` needs a live `subscriptions.retrieve` call and is
covered by the manual Stripe-CLI flow in the README instead.

- Location: `firebase/functions/test/` (vitest, serial files)
- `test/helpers.ts` is the single toolkit: supertest request client
  (`get`/`post`/`del` + anon variants + `postWebhook`), `makeUserToken`
  (real Auth-emulator user + REST sign-in for a real ID token; also upserts
  the `users/{uid}` identity doc, mirroring the production invariant),
  `clearFirestore`, seed factories (`seedOrg`, `seedMember`, `seedUsage`,
  `seedInvite`, `seedClient`, `seedTask` — complete production-shaped docs,
  `over` spread last), `stripeEnv` (save/set/restore), `stripeSignature`,
  `pollUntil`, `containsKeyDeep`. Tests never hand-write Firestore docs or
  requests outside these helpers.

### Running

Iterating (leave the emulators up in one terminal):

```bash
# terminal 1
cd firebase && npm run emulators

# terminal 2
cd firebase/functions && npm test        # typecheck + vitest run
cd firebase/functions && npm run test:watch   # fast inner loop (no typecheck)
```

One-shot (CI-style — boots emulators, runs, tears down):

```bash
cd firebase && npm run test:integration
```

If the emulators aren't running, the suite fails fast with a single clear
"emulator not reachable" error — never a wall of connection-refused failures.

### Typecheck gates the tests

Vitest strips types via esbuild **without checking them** — green tests do not
prove compilation. `npm test` therefore runs
`tsc --noEmit -p tsconfig.test.json` first (a check-only project covering
`src/` + `test/`; the build tsconfig and `lib/` output are untouched).

### The mandatory coverage matrix

Every new protected route ships with tests covering, at minimum:

1. **Unauthenticated** → 401
2. **Unverified email** → 403 (when the route sits behind `requireAuth`)
3. **Wrong org** (valid user, another org's resource — e.g. a manager of org B
   hitting org A) → 403
4. **Insufficient role** (the role that should be denied) → 403
5. **Happy path** → 200/201 with response-shape assertions
6. **Side-effect assertions** on raw Firestore state (counters, denormalized
   fields, idempotency markers), via `pollUntil` for fire-and-forget writes

Deny paths get tests, not just happy paths — that's where the risk lives.
`test/orgs.test.ts` is the reference implementation.

### Pitfalls (encoded in the setup — don't undo them)

- **Wipe in `beforeEach`, never `afterEach`** — a crashed test must not poison
  the next run. `clearFirestore()` is one REST DELETE against the emulator.
- **Test files run serially** (`fileParallelism: false`) — they share one
  emulator; parallel files would trash each other's data.
- **Auth users persist across `clearFirestore()`** — `makeUserToken` is
  create-or-update idempotent; still use unique, readable uids per test
  (`u-inv-accept`, `u-mem-leaver`, …).
- **Composite indexes are NOT enforced by the emulator.** A compound query can
  pass every test and throw `FAILED_PRECONDITION` in production — review
  `firestore.indexes.json` whenever adding one.
- **Stripe env is wiped in `test/setup.ts`** for determinism; billing tests
  opt in per `describe` via `stripeEnv({...})` and restore in `afterAll`.
  `billingEnabled()`/`priceIdFor()` read env lazily so this works; note
  `getStripe()` caches its client after first use, but no offline-tested code
  path uses the client's API key.
- **Scheduled jobs never fire in the emulator** — keep their logic in plain
  exported functions (`reconcileOrg`) and test those directly
  (see `test/reconcile.test.ts`).
- **`req.rawBody`** is provided by the firebase-functions runtime, not by
  Express. The test harness in `helpers.ts` reproduces it (buffer raw bytes,
  pre-parse JSON, mark the body consumed) so Stripe signature verification
  runs on the exact payload bytes, as in production.
