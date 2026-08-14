/**
 * Grant a paid plan to an org (by admin email) — admin convenience script.
 *
 * Usage:
 *   npx tsx scripts/grant-plan.ts --email admin@example.com --plan studio --months 12
 *
 * Options:
 *   --email    The org admin's email
 *   --plan     One of: studio, agency
 *   --months   How many months to grant (1–36)
 *   --org      Org ID (required when user belongs to multiple orgs)
 *   --ref      A reference note for the audit trail (optional)
 *   --project  Firebase project id (optional, defaults to GCLOUD_PROJECT or 'demo-app')
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or running in a GCP environment.
 * This writes directly to Firestore — it does NOT go through the API.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseArgs } from 'node:util';

// ── CLI args ────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    plan: { type: 'string' },
    months: { type: 'string' },
    org: { type: 'string' },
    ref: { type: 'string' },
    project: { type: 'string' },
  },
  strict: true,
});

const VALID_PLANS = ['studio', 'agency'] as const;
type PaidPlan = (typeof VALID_PLANS)[number];

const email = values.email;
const plan = values.plan as PaidPlan | undefined;
const months = values.months ? parseInt(values.months, 10) : undefined;
const reference = values.ref ?? 'grant-plan script';
const explicitOrg = values.org;
const projectId = values.project ?? process.env.GCLOUD_PROJECT ?? 'demo-app';

// ── Validation ──────────────────────────────────────────────────────
if (!email) {
  console.error('❌ --email is required');
  process.exit(1);
}
if (!plan || !VALID_PLANS.includes(plan)) {
  console.error(`❌ --plan must be one of: ${VALID_PLANS.join(', ')}`);
  process.exit(1);
}
if (!months || months < 1 || months > 36 || isNaN(months)) {
  console.error('❌ --months must be an integer between 1 and 36');
  process.exit(1);
}

// ── Firebase init ───────────────────────────────────────────────────
initializeApp({ projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // 1. Find the user by email
  console.log(`🔍 Looking up user with email: ${email}`);
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (usersSnap.empty) {
    console.error(`❌ No user found with email "${email}"`);
    process.exit(1);
  }

  const userDoc = usersSnap.docs[0];
  const uid = userDoc.id;
  console.log(`   Found user: ${uid}`);

  // 2. Resolve org id from memberships
  const memberSnap = await db.collectionGroup('members').where('uid', '==', uid).get();
  if (memberSnap.empty) {
    console.error('❌ This user has no org memberships');
    process.exit(1);
  }

  // Extract org ids from paths: orgs/{orgId}/members/{uid}
  const orgIds = memberSnap.docs.map(d => d.ref.parent.parent!.id);
  let orgId: string;

  if (explicitOrg) {
    if (!orgIds.includes(explicitOrg)) {
      console.error(`❌ User is not a member of org "${explicitOrg}"`);
      console.error(`   Their orgs: ${orgIds.join(', ')}`);
      process.exit(1);
    }
    orgId = explicitOrg;
  } else if (orgIds.length === 1) {
    orgId = orgIds[0];
  } else {
    // Multiple orgs — check if only one has admin role
    const adminOrgs = memberSnap.docs
      .filter(d => d.get('role') === 'admin')
      .map(d => d.ref.parent.parent!.id);
    if (adminOrgs.length === 1) {
      orgId = adminOrgs[0];
    } else {
      console.error('❌ User belongs to multiple orgs. Use --org <orgId> to specify:');
      for (const oid of orgIds) {
        const orgSnap = await db.collection('orgs').doc(oid).get();
        const name = orgSnap.get('name') ?? '(unnamed)';
        const role = memberSnap.docs.find(d => d.ref.parent.parent!.id === oid)?.get('role') ?? '?';
        console.error(`   ${oid}  →  ${name} (role: ${role})`);
      }
      process.exit(1);
    }
  }

  console.log(`   Org: ${orgId}`);

  // 3. Read existing billing/usage doc
  const billingRef = db.collection('orgs').doc(orgId).collection('billing').doc('subscription');
  const billingSnap = await billingRef.get();

  const now = new Date();
  const currentPaid = billingSnap.get('paidUntil') as Timestamp | undefined;
  const from = currentPaid && currentPaid.toDate() > now ? currentPaid.toDate() : now;
  const paidUntil = new Date(from);
  paidUntil.setMonth(paidUntil.getMonth() + months!);

  // 4. Write the plan grant
  const history = (billingSnap.get('history') as unknown[]) ?? [];

  await billingRef.set({
    orgId,
    plan,
    status: 'active',
    source: 'manual',
    paidUntil: Timestamp.fromDate(paidUntil),
    history: [...history, {
      at: Timestamp.fromDate(now),
      action: 'manual-grant',
      plan,
      reference,
      by: 'script:grant-plan',
    }],
    ...(billingSnap.exists ? {} : { createdAt: Timestamp.fromDate(now) }),
    updatedAt: Timestamp.fromDate(now),
  }, { merge: true });

  console.log('');
  console.log('✅ Plan granted successfully:');
  console.log(`   Org:        ${orgId}`);
  console.log(`   Plan:       ${plan}`);
  console.log(`   Months:     ${months}`);
  console.log(`   PaidUntil:  ${paidUntil.toISOString()}`);
  console.log(`   Reference:  ${reference}`);
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
