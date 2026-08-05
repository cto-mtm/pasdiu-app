#!/usr/bin/env node
// grant-plan.mjs — Grant a paid plan to all orgs owned/administered by a user.
//
// Usage:
//   node grant-plan.mjs <email> [plan]
//
// Examples:
//   node grant-plan.mjs editor@pasdiu.test studio
//   node grant-plan.mjs north@pasdiu.test agency
//   node grant-plan.mjs admin@pasdiu.test free        # downgrade back
//
// Defaults to "studio" if no plan argument is given.
//
// By default targets the emulators (demo-app). To run against a real project,
// set GOOGLE_APPLICATION_CREDENTIALS and GCLOUD_PROJECT env vars, and unset
// the emulator host vars.

import admin from "firebase-admin";

// ─── Plan limits (mirrors @pasdiu/shared PLAN_LIMITS) ────────────────────────
const PLAN_LIMITS = {
  free:   { seatLimit: 3,  clientLimit: 3,  taskLimit: 500,   deliverableLimit: 50 },
  studio: { seatLimit: 20, clientLimit: -1, taskLimit: 10000, deliverableLimit: 2000 },
  agency: { seatLimit: -1, clientLimit: -1, taskLimit: -1,    deliverableLimit: -1 },
};

const VALID_PLANS = Object.keys(PLAN_LIMITS);

// ─── CLI args ────────────────────────────────────────────────────────────────
const email = process.argv[2];
const plan = process.argv[3] || "studio";

if (!email) {
  console.error("Usage: node grant-plan.mjs <email> [plan]");
  console.error(`  Plans: ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}

if (!VALID_PLANS.includes(plan)) {
  console.error(`Invalid plan "${plan}". Must be one of: ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}

// ─── Firebase init (emulators by default) ────────────────────────────────────
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-app" });
const db = admin.firestore();
const auth = admin.auth();

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Look up user by email
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`Found user: ${user.displayName || user.uid} (${user.email})`);

  // 2. Find all orgs where this user is an admin or owner
  const memberSnaps = await db.collectionGroup("members")
    .where("uid", "==", user.uid)
    .get();

  if (memberSnaps.empty) {
    console.error(`User ${email} is not a member of any org.`);
    process.exit(1);
  }

  // Filter to orgs where user is admin (or owner)
  const adminOrgs = [];
  const memberOrgs = [];

  for (const doc of memberSnaps.docs) {
    const data = doc.data();
    const orgId = doc.ref.parent.parent.id;
    if (data.role === "admin") {
      adminOrgs.push(orgId);
    } else {
      memberOrgs.push(orgId);
    }
  }

  // If user is admin of any org, upgrade those. Otherwise upgrade all their orgs.
  const targetOrgIds = adminOrgs.length > 0 ? adminOrgs : memberOrgs;

  if (targetOrgIds.length === 0) {
    console.error(`User ${email} has no orgs to upgrade.`);
    process.exit(1);
  }

  // 3. Apply the plan to each target org
  const limits = PLAN_LIMITS[plan];
  const subscriptionStatus = plan === "free" ? "none" : "active";

  for (const orgId of targetOrgIds) {
    const orgRef = db.doc(`orgs/${orgId}`);
    const orgSnap = await orgRef.get();
    const orgName = orgSnap.exists ? orgSnap.data().name : orgId;
    const currentPlan = orgSnap.exists ? orgSnap.data().plan : "unknown";

    await orgRef.update({
      plan,
      seatLimit: limits.seatLimit,
      clientLimit: limits.clientLimit,
      taskLimit: limits.taskLimit,
      deliverableLimit: limits.deliverableLimit,
      subscriptionStatus,
    });

    console.log(`✓ ${orgName} (${orgId}): ${currentPlan} → ${plan}`);
  }

  console.log("\nDone. Plan limits applied:");
  console.log(`  seats: ${limits.seatLimit === -1 ? "unlimited" : limits.seatLimit}`);
  console.log(`  clients: ${limits.clientLimit === -1 ? "unlimited" : limits.clientLimit}`);
  console.log(`  tasks: ${limits.taskLimit === -1 ? "unlimited" : limits.taskLimit}`);
  console.log(`  deliverables: ${limits.deliverableLimit === -1 ? "unlimited" : limits.deliverableLimit}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
