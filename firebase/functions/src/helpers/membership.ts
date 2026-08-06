import type { Firestore } from "firebase-admin/firestore";
import { ApiError, MANAGER_ROLES } from "./apiErrors.js";

export interface MembershipInfo {
  role: string;
  clientId: string;
}

/**
 * Load a user's membership in an org — throws 403 if they're not a member.
 * Consolidates the repeated pattern of reading + checking the member doc.
 */
export async function getMembershipOrThrow(
  db: Firestore,
  orgId: string,
  uid: string,
): Promise<MembershipInfo> {
  const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!snap.exists) throw new ApiError(403, "not_a_member");
  return {
    role: snap.get("role") as string,
    clientId: (snap.get("clientId") as string) ?? "",
  };
}

/**
 * Load the org doc, throwing 404 if it doesn't exist. Saves the repeated
 * getDoc + existence check across route handlers.
 */
export async function getOrgOrThrow(db: Firestore, orgId: string) {
  const ref = db.doc(`orgs/${orgId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, "org_not_found");
  return { ref, snap, data: snap.data()! };
}

/**
 * Combined: verify the caller is a manager AND load the org doc in one
 * batched read. Eliminates the round-trip of two sequential reads.
 */
export async function requireManagerAndGetOrg(
  db: Firestore,
  orgId: string,
  uid: string,
) {
  const [memberSnap, orgSnap] = await db.getAll(
    db.doc(`orgs/${orgId}/members/${uid}`),
    db.doc(`orgs/${orgId}`),
  );
  if (!memberSnap.exists || !MANAGER_ROLES.includes(memberSnap.get("role"))) {
    throw new ApiError(403, "managers_only");
  }
  if (!orgSnap.exists) throw new ApiError(404, "org_not_found");
  return { ref: orgSnap.ref, snap: orgSnap, data: orgSnap.data()! };
}
