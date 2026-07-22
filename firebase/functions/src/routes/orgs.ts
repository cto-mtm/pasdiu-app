import express from "express";
import { FieldValue, getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { requireAuth } from "../helpers/auth.js";
import {
  ApiError,
  asyncHandler,
  userOf,
  displayNameOf,
  emailOf,
  requireManagerOf,
  MANAGER_ROLES,
} from "../helpers/apiErrors.js";
import { syncSeatQuantity } from "../helpers/stripeHandlers.js";
import { reconcileOrg } from "../helpers/reconcile.js";
import { sendInviteEmailFor } from "../helpers/inviteMail.js";
import { PLAN_LIMITS } from "../plans.js";

export const orgsRouter = express.Router();

// ── Invite helpers ──────────────────────────────────────────────────────────

// Invites expire server-side (preview/GET/accept all 404 past expiresAt).
// A missing expiresAt means the invite predates expiry — still valid.
function inviteExpired(invite: FirebaseFirestore.DocumentData): boolean {
  const expiresAt = invite.expiresAt as { toMillis?: () => number } | undefined;
  return typeof expiresAt?.toMillis === "function" && expiresAt.toMillis() < Date.now();
}

/** Mask an email for the public invite preview: "l•••@acme.com". */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

// GET /orgs/:orgId/invites/:inviteId/preview — the ONLY unauthenticated route
// on this router (registered before requireAuth). The signed-out invite page
// uses it to show which workspace/role the link is for and a MASKED hint of
// the addressed email, so recipients sign up with the right account instead
// of discovering the mismatch after account creation. The unguessable invite
// id is the capability token; the full email is never exposed here.
orgsRouter.get(
  "/:orgId/invites/:inviteId/preview",
  asyncHandler(async (req, res) => {
    const { orgId, inviteId } = req.params;
    const db = getFirestore();
    const [orgSnap, inviteSnap] = await Promise.all([
      db.doc(`orgs/${orgId}`).get(),
      db.doc(`orgs/${orgId}/invites/${inviteId}`).get(),
    ]);
    const invite = inviteSnap.data();
    if (
      !orgSnap.exists || !invite || invite.status !== "pending" ||
      typeof invite.email !== "string" || inviteExpired(invite)
    ) {
      throw new ApiError(404, "Invite not found");
    }
    res.json({
      orgName: orgSnap.get("name"),
      role: invite.role,
      emailHint: maskEmail(invite.email),
    });
  })
);

orgsRouter.use(requireAuth);

// POST /orgs
orgsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 60) {
      throw new ApiError(400, "name must be a non-empty string of at most 60 characters");
    }

    const db = getFirestore();
    const orgRef = db.collection("orgs").doc();
    const displayName = displayNameOf(user);
    const email = emailOf(user);

    const batch = db.batch();
    batch.set(orgRef, {
      name,
      createdAt: FieldValue.serverTimestamp(),
      ownerUid: user.uid,
      plan: "free",
      seatLimit: PLAN_LIMITS.free.seatLimit,
      clientLimit: PLAN_LIMITS.free.clientLimit,
      taskLimit: PLAN_LIMITS.free.taskLimit,
      subscriptionStatus: "none",
    });
    batch.set(
      db.doc(`users/${user.uid}`),
      { displayName, email, createdAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    batch.set(orgRef.collection("members").doc(user.uid), {
      uid: user.uid,
      orgId: orgRef.id,
      orgName: name,
      displayName,
      email,
      role: "admin",
      joinedAt: FieldValue.serverTimestamp(),
    });
    batch.set(orgRef.collection("usage").doc("current"), {
      seats: 1,
      activeClients: 0,
      activeTasks: 0,
    });
    await batch.commit();

    res.status(201).json({ orgId: orgRef.id });
  })
);

// PATCH /orgs/:orgId — rename (managers). The org name is denormalized onto
// every member doc (it powers the org switcher and membership lists), and
// clients may not touch member docs' orgName, so the rename and the fan-out
// happen here in chunked batches. Invites need no fan-out — the invite
// endpoint reads the org doc live.
const RENAME_COOLDOWN_MS = 5_000;

orgsRouter.patch(
  "/:orgId",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 60) {
      throw new ApiError(400, "invalid_name");
    }

    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);
    const orgRef = db.doc(`orgs/${orgId}`);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) throw new ApiError(404, "org_not_found");

    // Rate-limit: reject if renamed less than 5 s ago.
    const lastRenamed = orgSnap.get("renamedAt");
    if (lastRenamed && typeof lastRenamed.toMillis === "function") {
      const elapsed = Date.now() - (lastRenamed.toMillis() as number);
      if (elapsed < RENAME_COOLDOWN_MS) {
        throw new ApiError(429, "rename_cooldown");
      }
    }

    // Fan-out to member docs in chunked batches (Firestore limit: 500 ops).
    const members = await orgRef.collection("members").get();
    const BATCH_LIMIT = 499; // reserve 1 slot for the org doc in the first batch
    const chunks: QueryDocumentSnapshot[][] = [];
    for (let i = 0; i < members.docs.length; i += BATCH_LIMIT) {
      chunks.push(members.docs.slice(i, i + BATCH_LIMIT));
    }

    // First batch: update org doc + first chunk of members.
    const firstBatch = db.batch();
    firstBatch.update(orgRef, {
      name,
      renamedAt: FieldValue.serverTimestamp(),
      renamedBy: user.uid,
    });
    for (const m of (chunks[0] ?? [])) firstBatch.update(m.ref, { orgName: name });
    await firstBatch.commit();

    // Remaining chunks (if any) in separate batches.
    for (const chunk of chunks.slice(1)) {
      const b = db.batch();
      for (const m of chunk) b.update(m.ref, { orgName: name });
      await b.commit();
    }

    res.json({ orgId, name });
  })
);

// GET /orgs/:orgId/invites/:inviteId
orgsRouter.get(
  "/:orgId/invites/:inviteId",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, inviteId } = req.params;
    const db = getFirestore();
    const [orgSnap, inviteSnap] = await Promise.all([
      db.doc(`orgs/${orgId}`).get(),
      db.doc(`orgs/${orgId}/invites/${inviteId}`).get(),
    ]);
    const invite = inviteSnap.data();
    if (
      !orgSnap.exists || !invite || invite.status !== "pending" ||
      invite.email !== emailOf(user) || inviteExpired(invite)
    ) {
      throw new ApiError(404, "Invite not found");
    }
    res.json({ orgName: orgSnap.get("name"), role: invite.role, email: invite.email });
  })
);

// POST /orgs/:orgId/invites/:inviteId/resend — managers re-queue the invite
// email. queueMail's non-merge set on the deterministic mail id wipes the
// extension's `delivery` state, which makes firestore-send-email redeliver.
orgsRouter.post(
  "/:orgId/invites/:inviteId/resend",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, inviteId } = req.params;
    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);
    const inviteSnap = await db.doc(`orgs/${orgId}/invites/${inviteId}`).get();
    const invite = inviteSnap.data();
    if (!invite || invite.status !== "pending" || inviteExpired(invite)) {
      throw new ApiError(404, "Invite not found");
    }
    const queued = await sendInviteEmailFor(db, orgId, inviteId, invite);
    // Only unqueued path left after the checks above: prod without APP_URL.
    if (!queued) throw new ApiError(503, "mail_unavailable");
    res.json({ queued: true });
  })
);

// POST /orgs/:orgId/invites/:inviteId/accept
orgsRouter.post(
  "/:orgId/invites/:inviteId/accept",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, inviteId } = req.params;
    const db = getFirestore();
    const orgRef = db.doc(`orgs/${orgId}`);
    const inviteRef = db.doc(`orgs/${orgId}/invites/${inviteId}`);
    const memberRef = db.doc(`orgs/${orgId}/members/${user.uid}`);
    const usageRef = db.doc(`orgs/${orgId}/usage/current`);

    await db.runTransaction(async (tx) => {
      const [orgSnap, inviteSnap, memberSnap, usageSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(inviteRef),
        tx.get(memberRef),
        tx.get(usageRef),
      ]);
      if (memberSnap.exists) return; // already a member — idempotent success
      const invite = inviteSnap.data();
      if (
        !orgSnap.exists || !invite || invite.status !== "pending" ||
        invite.email !== emailOf(user) || inviteExpired(invite)
      ) {
        throw new ApiError(404, "Invite not found");
      }
      const seatLimit = orgSnap.get("seatLimit");
      const seats = usageSnap.get("seats");
      if (
        typeof seatLimit === "number" && seatLimit !== -1 &&
        typeof seats === "number" && seats >= seatLimit
      ) {
        throw new ApiError(409, "seat_limit");
      }
      const member: Record<string, unknown> = {
        uid: user.uid,
        orgId,
        orgName: orgSnap.get("name"),
        displayName: displayNameOf(user),
        email: emailOf(user),
        role: invite.role,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invite.invitedBy ?? null,
      };
      if (invite.clientId) member.clientId = invite.clientId;
      tx.set(memberRef, member);
      tx.update(usageRef, { seats: FieldValue.increment(1) });
      tx.update(inviteRef, { status: "accepted" });
    });

    await syncSeatQuantity(db, orgId);

    res.json({ orgId });
  })
);

// DELETE /orgs/:orgId/members/:uid
orgsRouter.delete(
  "/:orgId/members/:uid",
  asyncHandler(async (req, res) => {
    const caller = userOf(req);
    const { orgId, uid } = req.params;
    const db = getFirestore();
    const orgRef = db.doc(`orgs/${orgId}`);
    const memberRef = db.doc(`orgs/${orgId}/members/${uid}`);
    const usageRef = db.doc(`orgs/${orgId}/usage/current`);

    await db.runTransaction(async (tx) => {
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) throw new ApiError(404, "Org not found");
      if (orgSnap.get("ownerUid") === uid) throw new ApiError(409, "The org owner cannot be removed");
      if (uid !== caller.uid) {
        const callerSnap = await tx.get(db.doc(`orgs/${orgId}/members/${caller.uid}`));
        if (!callerSnap.exists || !MANAGER_ROLES.includes(callerSnap.get("role"))) {
          throw new ApiError(403, "Managers only");
        }
      }
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) throw new ApiError(404, "Member not found");
      tx.delete(memberRef);
      tx.update(usageRef, { seats: FieldValue.increment(-1) });
    });

    await syncSeatQuantity(db, orgId);

    res.status(204).send();
  })
);

// POST /orgs/:orgId/reconcile
orgsRouter.post(
  "/:orgId/reconcile",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    if (!orgSnap.exists) throw new ApiError(404, "Org not found");
    res.json(await reconcileOrg(orgId));
  })
);
