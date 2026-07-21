// Entry point. Cloud Functions discovers exports from lib/index.js (see package.json "main").
// firebase-admin is initialized once here (Application Default credentials in
// prod; the emulators are picked up automatically via FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST).
import { getApps, initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-east5" });

if (getApps().length === 0) initializeApp();

export { api } from "./api.js";
export { reconcileUsage } from "./triggers/reconcileUsage.js";
export { onInviteCreated } from "./triggers/onInviteCreated.js";
