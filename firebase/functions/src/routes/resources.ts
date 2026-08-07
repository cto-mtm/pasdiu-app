import express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "../helpers/auth.js";
import {
  ApiError,
  asyncHandler,
  userOf,
  requireManagerOf,
} from "../helpers/apiErrors.js";
import { cascadeDelete } from "../helpers/cascade.js";

// Cascade deletes for the workspace hierarchy. Each removes its whole subtree —
// deliverables and tasks (with their versions/notes), sub-groups, and the root
// doc — so nothing is ever orphaned, and it fixes the usage counters in one
// authoritative place. Server-side because deliverables are functions-only for
// delete and only the Admin SDK can move activeDeliverables. See helpers/cascade.ts.
export const resourcesRouter = express.Router();

resourcesRouter.use(requireAuth);

// DELETE /orgs/:orgId/subgroups/:subGroupId — the sub-group, its deliverables,
// and their stage tasks (plus any standalone tasks filed directly under it).
resourcesRouter.delete(
  "/:orgId/subgroups/:subGroupId",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, subGroupId } = req.params;
    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);

    const sgRef = db.doc(`subGroups/${subGroupId}`);
    const sgSnap = await sgRef.get();
    if (!sgSnap.exists || sgSnap.get("orgId") !== orgId) {
      throw new ApiError(404, "subgroup_not_found");
    }

    const [taskSnap, delSnap] = await Promise.all([
      db.collection("tasks").where("orgId", "==", orgId).where("subGroupId", "==", subGroupId).get(),
      db.collection("deliverables").where("orgId", "==", orgId).where("subGroupId", "==", subGroupId).get(),
    ]);

    const result = await cascadeDelete({
      orgId,
      taskDocs: taskSnap.docs,
      deliverableDocs: delSnap.docs,
      extraRefs: [sgRef],
    });
    res.json({ orgId, subGroupId, ...result });
  })
);

// DELETE /orgs/:orgId/projects/:projectId — the project, its sub-groups,
// deliverables, and tasks.
resourcesRouter.delete(
  "/:orgId/projects/:projectId",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, projectId } = req.params;
    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);

    const projRef = db.doc(`projects/${projectId}`);
    const projSnap = await projRef.get();
    if (!projSnap.exists || projSnap.get("orgId") !== orgId) {
      throw new ApiError(404, "project_not_found");
    }

    const [taskSnap, delSnap, sgSnap] = await Promise.all([
      db.collection("tasks").where("orgId", "==", orgId).where("projectId", "==", projectId).get(),
      db.collection("deliverables").where("orgId", "==", orgId).where("projectId", "==", projectId).get(),
      db.collection("subGroups").where("orgId", "==", orgId).where("projectId", "==", projectId).get(),
    ]);

    const result = await cascadeDelete({
      orgId,
      taskDocs: taskSnap.docs,
      deliverableDocs: delSnap.docs,
      extraRefs: [...sgSnap.docs.map((d) => d.ref), projRef],
    });
    res.json({ orgId, projectId, subGroupCount: sgSnap.size, ...result });
  })
);

// DELETE /orgs/:orgId/clients/:clientId — the client and its entire subtree.
// Tasks and deliverables carry clientId, so they come back in one query each;
// sub-groups only carry projectId, so they fan out over the client's projects.
resourcesRouter.delete(
  "/:orgId/clients/:clientId",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId, clientId } = req.params;
    const db = getFirestore();
    await requireManagerOf(db, orgId, user.uid);

    const clientRef = db.doc(`clients/${clientId}`);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists || clientSnap.get("orgId") !== orgId) {
      throw new ApiError(404, "client_not_found");
    }

    const [projSnap, taskSnap, delSnap] = await Promise.all([
      db.collection("projects").where("orgId", "==", orgId).where("clientId", "==", clientId).get(),
      db.collection("tasks").where("orgId", "==", orgId).where("clientId", "==", clientId).get(),
      db.collection("deliverables").where("orgId", "==", orgId).where("clientId", "==", clientId).get(),
    ]);

    const subGroupSnaps = await Promise.all(
      projSnap.docs.map((p) =>
        db.collection("subGroups").where("orgId", "==", orgId).where("projectId", "==", p.id).get()
      )
    );
    const subGroupRefs = subGroupSnaps.flatMap((s) => s.docs.map((d) => d.ref));

    const result = await cascadeDelete({
      orgId,
      taskDocs: taskSnap.docs,
      deliverableDocs: delSnap.docs,
      extraRefs: [...subGroupRefs, ...projSnap.docs.map((d) => d.ref), clientRef],
      clientRemoved: true,
    });
    res.json({
      orgId,
      clientId,
      projectCount: projSnap.size,
      subGroupCount: subGroupRefs.length,
      ...result,
    });
  })
);
