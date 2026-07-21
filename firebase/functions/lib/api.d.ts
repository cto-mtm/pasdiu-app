declare const app: import("express-serve-static-core").Express;
export { app };
/**
 * Single HTTP function hosting the Express app. `/health` is public;
 * `/billing/webhook` is authenticated by Stripe signature; everything under
 * `/orgs` and `/billing` requires a verified Firebase ID token
 * (see helpers/auth.ts). Validate any request body before trusting it.
 */
export declare const api: import("firebase-functions/v2/https").HttpsFunction;
