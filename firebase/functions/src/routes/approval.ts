import express from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "../helpers/auth.js";
import {
  ApiError,
  asyncHandler,
  userOf,
  MANAGER_ROLES,
} from "../helpers/apiErrors.js";

export const approvalRouter = express.Router();

approvalRouter.use(requireAuth);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getDeliverableOrThrow(db: FirebaseFirestore.Firestore, orgId: string, deliverableId: string) {
  const snap = await db.doc(`deliverables/${deliverableId}`).get();
  if (!snap.exists) throw new ApiError(404, "deliverable_not_found");
  const data = snap.data()!;
  if (data.orgId !== orgId) throw new ApiError(403, "wrong_org");
  return { ref: snap.ref, data };
}

async function getMemberRole(db: FirebaseFirestore.Firestore, orgId: string, uid: string) {
  const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!snap.exists) throw new ApiError(403, "not_a_member");
  return {
    role: snap.get("role") as string,
    clientId: (snap.get("clientId") as string) ?? "",
  };
}

// Terminal statuses — a task in any of these states is "done" for stage purposes.
const TERMINAL_STATUSES = new Set(["approved", "done", "delivered"]);

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Find the current non-terminal task for a deliverable (the first task whose
// status is not terminal, ordered by stage position from the deliverable).
async function findCurrentTask(db: FirebaseFirestore.Firestore, deliverableId: string) {
  const [delSnap, tasksSnap] = await Promise.all([
    db.doc(`deliverables/${deliverableId}`).get(),
    db.collection("tasks").where("deliverableId", "==", deliverableId).get(),
  ]);

  if (!delSnap.exists) return null;
  const stages = (delSnap.data()!.stages ?? []) as Array<{ id: string }>;
  const tasksByStageId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of tasksSnap.docs) {
    const stageId = doc.get("stageId") as string;
    if (stageId) tasksByStageId.set(stageId, doc);
  }

  // Walk stages in order, find the first non-terminal task.
  for (const stage of stages) {
    const taskDoc = tasksByStageId.get(stage.id);
    if (taskDoc && !isTerminal(taskDoc.get("status") as string)) {
      return taskDoc;
    }
  }
  return null;
}

// Advance the current stage task to 'approved' status.
async function advanceApprovalTask(db: FirebaseFirestore.Firestore, deliverableId: string) {
  const taskDoc = await findCurrentTask(db, deliverableId);
  if (taskDoc) {
    await taskDoc.ref.update({ status: "approved", completedAt: FieldValue.serverTimestamp() });
  }
}

// ── POST /orgs/:orgId/deliverables/:deliverableId/approve ───────────────────
approvalRouter.post(
  "/:orgId/deliverables/:deliverableId/approve",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, deliverableId } = req.params;
    const db = getFirestore();

    const { role, clientId } = await getMemberRole(db, orgId, user.uid);
    const { ref: delRef, data: del } = await getDeliverableOrThrow(db, orgId, deliverableId);

    let approvedVia: string;
    let approvalNote = "";

    if (role === "client") {
      // Client: must own this tenant and deliverable must be visible.
      if (del.clientId !== clientId) throw new ApiError(403, "wrong_tenant");
      if (!del.clientVisible) throw new ApiError(403, "not_visible");
      approvedVia = "portal";
    } else if (MANAGER_ROLES.includes(role)) {
      // Manager proxy approval: note is required.
      approvalNote = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      approvedVia = req.body?.via === "external" ? "external" : "in_person";
      if (!approvalNote) throw new ApiError(400, "approval_note_required");
    } else {
      throw new ApiError(403, "unauthorized_role");
    }

    // Write attribution — server-stamped, cannot be forged by the client SDK.
    await delRef.update({
      approvedBy: user.uid,
      approvedVia,
      approvedAt: FieldValue.serverTimestamp(),
      approvalNote,
      status: "delivered",
      deliveredAt: FieldValue.serverTimestamp(),
    });

    // Advance the current stage task.
    await advanceApprovalTask(db, deliverableId);

    res.json({ deliverableId, approvedVia, approvedBy: user.uid });
  })
);

// ── POST /orgs/:orgId/deliverables/:deliverableId/request-changes ───────────
approvalRouter.post(
  "/:orgId/deliverables/:deliverableId/request-changes",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, deliverableId } = req.params;
    const db = getFirestore();

    const { role, clientId } = await getMemberRole(db, orgId, user.uid);
    const { ref: delRef, data: del } = await getDeliverableOrThrow(db, orgId, deliverableId);

    // Only clients can request changes.
    if (role !== "client") throw new ApiError(403, "client_only");
    if (del.clientId !== clientId) throw new ApiError(403, "wrong_tenant");
    if (!del.clientVisible) throw new ApiError(403, "not_visible");

    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

    // Set the current stage task to 'revisions'.
    let revisionedTaskId = "";
    const taskDoc = await findCurrentTask(db, deliverableId);
    if (taskDoc) {
      await taskDoc.ref.update({ status: "revisions", completedAt: null });
      revisionedTaskId = taskDoc.id;
    }

    // Add the note to the deliverable's notes subcollection (if provided).
    if (note) {
      await db.collection(`deliverables/${deliverableId}/notes`).add({
        versionId: "",
        authorUid: user.uid,
        body: note,
        resolved: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ deliverableId, taskId: revisionedTaskId, note: !!note });
  })
);

// ── POST /orgs/:orgId/deliverables/bulk-approve ─────────────────────────────
approvalRouter.post(
  "/:orgId/deliverables/bulk-approve",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const db = getFirestore();

    const { role, clientId } = await getMemberRole(db, orgId, user.uid);

    const deliverableIds = req.body?.deliverableIds;
    if (!Array.isArray(deliverableIds) || deliverableIds.length === 0) {
      throw new ApiError(400, "deliverableIds_required");
    }

    let approvedVia: string;
    let approvalNote = "";

    if (role === "client") {
      approvedVia = "portal";
    } else if (MANAGER_ROLES.includes(role)) {
      approvalNote = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      approvedVia = req.body?.via === "external" ? "external" : "in_person";
      if (!approvalNote) throw new ApiError(400, "approval_note_required");
    } else {
      throw new ApiError(403, "unauthorized_role");
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const delId of deliverableIds) {
      try {
        const snap = await db.doc(`deliverables/${delId}`).get();
        if (!snap.exists || snap.get("orgId") !== orgId) {
          results.push({ id: delId, ok: false, error: "not_found" });
          continue;
        }
        const del = snap.data()!;

        // Client authorization per item.
        if (role === "client") {
          if (del.clientId !== clientId || !del.clientVisible) {
            results.push({ id: delId, ok: false, error: "unauthorized" });
            continue;
          }
        }

        await snap.ref.update({
          approvedBy: user.uid,
          approvedVia,
          approvedAt: FieldValue.serverTimestamp(),
          approvalNote,
          status: "delivered",
          deliveredAt: FieldValue.serverTimestamp(),
        });

        await advanceApprovalTask(db, delId);
        results.push({ id: delId, ok: true });
      } catch {
        results.push({ id: delId, ok: false, error: "write_failed" });
      }
    }

    res.json({
      orgId,
      approved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  })
);
