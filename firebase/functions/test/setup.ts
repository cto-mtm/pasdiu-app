// Point the Admin SDK and the Auth REST sign-in at the emulators BEFORE any
// app code imports firebase-admin — vitest runs setupFiles before each test
// file's module graph, so these are in place when test/helpers.ts calls
// initializeApp(). `||=` (not `=`) lets `firebase emulators:exec` / CI
// override the hosts without edits. Project id `demo-app` is offline-only
// (matches firebase/package.json's emulator scripts).
process.env.GCLOUD_PROJECT ||= "demo-app";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

// Determinism: never inherit Stripe config from the shell (or a stray
// functions/.env). billingEnabled()/getStripe()/priceIdFor() read process.env
// lazily on every call, so billing tests opt in explicitly per describe block
// via the stripeEnv() save/set/restore helper in test/helpers.ts.
for (const key of [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STUDIO_MONTHLY",
  "STRIPE_PRICE_STUDIO_ANNUAL",
  "STRIPE_PRICE_AGENCY_MONTHLY",
  "STRIPE_PRICE_AGENCY_ANNUAL",
]) {
  delete process.env[key];
}
