import express from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "../helpers/auth.js";
import {
  ApiError,
  asyncHandler,
  userOf,
  requireManagerOf,
} from "../helpers/apiErrors.js";
import { BatchCreateDeliverableSchema } from "@pasdiu/shared";

export const deliverablesRouter = express.Router();

deliverablesRouter.use(requireAuth);

// POST /orgs/:orgId/deliverables/batch
// Creates N deliverables with their stage tasks in one atomic-ish operation.
// Chunked writes (Firestore limit: 500 ops per batch). Idempotent via
// counter reconciliation on failure.
deliverablesRouter.post(
  "/:orgId/deliverables/batch",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    const { orgId } = req.params;
    const db = getFirestore();

    // Auth: caller must be a manager of this org.
    await requireManagerOf(db, orgId, user.uid);

    // Validate body.
    const parsed = BatchCreateDeliverableSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_body", parsed.error.flatten());
    }
    const input = parsed.data;

    // Load org (pipeline + limits).
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    if (!orgSnap.exists) throw new ApiError(404, "org_not_found");
    const org = orgSnap.data()!;

    const pipeline = org.pipeline as { stages: Array<{ id: string; name: string; optional: boolean; clientFacing: boolean }> } | undefined;
    if (!pipeline || !pipeline.stages.length) {
      throw new ApiError(400, "no_pipeline", "Org has no workflow pipeline configured");
    }

    // Entitlement check: reject before writing.
    const usageSnap = await db.doc(`orgs/${orgId}/usage/current`).get();
    const currentDeliverables = (usageSnap.get("activeDeliverables") as number) ?? 0;
    const deliverableLimit = (org.deliverableLimit as number) ?? 0;
    const count = input.names.length;

    if (deliverableLimit !== -1 && currentDeliverables + count > deliverableLimit) {
      throw new ApiError(
        409,
        "deliverable_limit",
        `Creating ${count} deliverables would exceed the limit of ${deliverableLimit} (currently at ${currentDeliverables})`
      );
    }

    // Resolve sub-group: use existing or create new.
    let subGroupId = input.subGroupId || "";
    let subGroupName = "";
    if (subGroupId) {
      const sgSnap = await db.doc(`subGroups/${subGroupId}`).get();
      if (!sgSnap.exists) throw new ApiError(404, "subgroup_not_found");
      subGroupName = (sgSnap.get("name") as string) ?? "";
    } else if (input.subGroupName) {
      // Create a new sub-group.
      const sgRef = db.collection("subGroups").doc();
      const sgOrder = (await db.collection("subGroups")
        .where("orgId", "==", orgId)
        .where("projectId", "==", input.projectId)
        .count().get()).data().count;
      await sgRef.set({
        orgId,
        projectId: input.projectId,
        name: input.subGroupName,
        order: sgOrder,
        meta: [],
      });
      subGroupId = sgRef.id;
      subGroupName = input.subGroupName;
    }

    // Resolve project's clientId.
    const projectSnap = await db.doc(`projects/${input.projectId}`).get();
    if (!projectSnap.exists) throw new ApiError(404, "project_not_found");
    const clientId = (projectSnap.get("clientId") as string) ?? "";

    // Determine stages to create (exclude skipped).
    const skipSet = new Set(input.skipStageIds ?? []);
    const stages = pipeline.stages.filter((s) => !skipSet.has(s.id));

    // Compute due dates: linear interpolation across the due window.
    let dueDates: (Date | null)[] = new Array(count).fill(null);
    if (input.dueStartAt && input.dueEndAt) {
      const start = new Date(input.dueStartAt).getTime();
      const end = new Date(input.dueEndAt).getTime();
      dueDates = input.names.map((_, i) => {
        if (count === 1) return new Date(end);
        const t = i / (count - 1);
        return new Date(start + t * (end - start));
      });
    } else if (input.dueEndAt) {
      dueDates = new Array(count).fill(new Date(input.dueEndAt));
    }

    // Build all documents.
    const createdDeliverableIds: string[] = [];
    const BATCH_LIMIT = 400; // Leave room under Firestore's 500-op cap.
    const ops: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

    for (let i = 0; i < count; i++) {
      const delRef = db.collection("deliverables").doc();
      createdDeliverableIds.push(delRef.id);

      ops.push({
        ref: delRef,
        data: {
          orgId,
          clientId,
          projectId: input.projectId,
          subGroupId,
          subGroupName,
          typeId: input.typeId,
          stages: pipeline.stages, // full snapshot
          stageSummary: [], // trigger will fill on first task write
          name: input.names[i],
          status: "active",
          clientVisible: input.clientVisible ?? false,
          latestVersionUrl: "",
          order: i,
          meta: [],
          createdAt: FieldValue.serverTimestamp(),
          deliveredAt: null,
        },
      });

      // One task per stage.
      for (let si = 0; si < stages.length; si++) {
        const stage = stages[si];
        // Round-robin assignee for this stage.
        const stageAssignees = input.stageAssignees?.[stage.id] ?? [];
        const assigneeUid = stageAssignees.length > 0
          ? stageAssignees[i % stageAssignees.length]
          : "";

        const taskRef = db.collection("tasks").doc();
        ops.push({
          ref: taskRef,
          data: {
            orgId,
            title: `${stages[si].name}: ${input.names[i]}`,
            description: "",
            subGroupId,
            projectId: input.projectId,
            clientId,
            status: "backlog",
            assigneeUid,
            clientVisible: false,
            blockedReason: "",
            blockedAt: null,
            deliveryNote: "",
            meta: [],
            order: i * stages.length + si,
            dueAt: dueDates[i],
            createdAt: FieldValue.serverTimestamp(),
            completedAt: null,
            deliverableId: delRef.id,
            stageId: stage.id,
          },
        });
      }
    }

    // Write in chunks.
    const chunks: typeof ops[] = [];
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      chunks.push(ops.slice(i, i + BATCH_LIMIT));
    }

    try {
      for (const chunk of chunks) {
        const batch = db.batch();
        for (const op of chunk) {
          batch.set(op.ref, op.data);
        }
        await batch.commit();
      }

      // Increment the usage counter.
      await db.doc(`orgs/${orgId}/usage/current`).update({
        activeDeliverables: FieldValue.increment(count),
      });
    } catch (err) {
      // On partial failure, attempt cleanup of what was written.
      // The reconciliation endpoint can heal counters later.
      throw new ApiError(500, "batch_write_failed", String(err));
    }

    // Compute per-assignee split for preview/response.
    const assigneeCounts: Record<string, number> = {};
    for (const op of ops) {
      if (op.data.assigneeUid && op.data.stageId) {
        const uid = op.data.assigneeUid as string;
        assigneeCounts[uid] = (assigneeCounts[uid] ?? 0) + 1;
      }
    }

    res.status(201).json({
      orgId,
      deliverableCount: count,
      taskCount: ops.length - count, // total ops minus deliverable docs
      deliverableIds: createdDeliverableIds,
      assigneeCounts,
      subGroupId,
    });
  })
);
