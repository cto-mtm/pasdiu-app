# Pasdiu

## Project Structure

- `shared/` — Monorepo shared package (`@pasdiu/shared`): domain models, plan constants, and Zod validation schemas
- `app/` — Vue 3 + Vite web app, wrapped by Capacitor for iOS/Android
- `firebase/` — Firebase Hosting config + Cloud Functions API (`firebase/functions`) + emulator scripts
- `docs/` — Internal documentation (read `docs/animations.md` before touching any animation, `docs/i18n.md` before touching any user-facing string, `docs/testing.md` before adding any API route or Firestore rule)
- `docs/deliverables/` — Plan of record for the deliverables & production-pipeline initiative. Read `docs/deliverables/README.md` before working on deliverables, workflow stages, packages, recording sessions, or the client portal — it documents three verified constraints that invalidate the obvious approaches.

## Development

- Monorepo workspace managed via NPM (`package.json` at root with `workspaces: ["shared", "app", "firebase/functions"]`).
- Cloud Functions bundler: `firebase/functions/esbuild.mjs` bundles TypeScript and inlines `@pasdiu/shared` into `lib/index.js` while keeping runtime dependencies external.
- **Do not** run `vite build`, `npm run build`, `cap sync`, or any build commands unless explicitly asked.
- **Do not** prompt the user asking if they would like to run a build.
- The dev server (`npm run dev`) and the Firebase emulators (`npm run emulators` in `firebase/`) are managed by the user separately.
- Local dev never needs a real Firebase project — the emulators run offline under the `demo-app` project id.
- Use `npm` as the package manager (not yarn or pnpm).

## Data & auth

- Firebase **Auth** + **Firestore** (both emulator-backed in dev; wired in `app/src/lib/firebase.ts`, emulators-only when `import.meta.env.DEV`).
- Pinia holds reactive client state; Firestore is the source of truth. All Firestore access goes through `app/src/stores/data.ts` — components never call the SDK directly.
- Roles (`admin`/`pm`/`contractor`/`client`) live on the `users/{uid}` doc and drive router landing + gating in `app/src/router/index.ts`.
- Seed demo users + data with `npm run seed` (in `firebase/`) while the emulators run. Security rules: `firebase/firestore.rules`.

## i18n rules (non-negotiable)

- No hardcoded user-facing strings in templates or stores — every string is a key in a per-feature module under `src/i18n/locales/**`, resolved with `useI18n()`'s `t()`.
- `en` is the source of truth; `es` is typed `typeof en`, so adding a string means adding the key to **both** locales in the same change (a divergence is a compile error).

## Animation rules (non-negotiable)

- Page-to-page animation goes through the View Transitions wrapper in `src/router/index.ts` — never call `document.startViewTransition` anywhere else.
- Hero transitions = matching `view-transition-name` on source and target, derived from the item id. Names must be unique per page.
- Animate only `transform` and `opacity`. Durations 200–350ms.
- All transition CSS lives in `src/assets/css/transitions.css`, organized as numbered recipes.
- Every animation must degrade gracefully: reduced-motion and unsupported browsers get instant navigation.
