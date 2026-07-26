import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type { TaskStatus } from "@pasdiu/shared";

// Trigger: when a task with a deliverableId is created/updated/deleted,
// re-derive the parent deliverable's stageSummary. This is a DISPLAY CACHE —
// the tasks remain the authority (see docs/deliverables/phase-1-domain-foundation.md § 3).
//
// Cost: one extra write per stage transition (~3,000/month for a 600-clip
// agency ≈ half a cent), avoiding millions of reads on list views.

export const onTaskWrite = onDocumentWritten(
  {
    document: "tasks/{taskId}",
    region: "us-east5",
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Determine the deliverableId from either the before or after state.
    const deliverableId =
      (after?.deliverableId as string) || (before?.deliverableId as string) || "";

    // Skip standalone tasks (no deliverable association).
    if (!deliverableId) return;

    // Only react to status changes (or create/delete). If the task's status
    // didn't change and the assignee/dueAt didn't change, the summary is
    // already correct.
    if (before && after) {
      const statusChanged = before.status !== after.status;
      const assigneeChanged = before.assigneeUid !== after.assigneeUid;
      const dueChanged =
        (before.dueAt?.toMillis?.() ?? null) !== (after.dueAt?.toMillis?.() ?? null);
      if (!statusChanged && !assigneeChanged && !dueChanged) return;
    }

    const db = getFirestore();
    const deliverableRef = db.doc(`deliverables/${deliverableId}`);
    const deliverableSnap = await deliverableRef.get();

    if (!deliverableSnap.exists) {
      logger.warn("onTaskWrite: deliverable not found, skipping summary update", {
        deliverableId,
        taskId: event.params.taskId,
      });
      return;
    }

    const deliverable = deliverableSnap.data()!;
    const stages = (deliverable.stages ?? []) as Array<{
      id: string;
      name: string;
    }>;

    // Load all tasks for this deliverable to rebuild the full summary.
    const tasksSnap = await db
      .collection("tasks")
      .where("deliverableId", "==", deliverableId)
      .get();

    const tasksByStageId = new Map<string, FirebaseFirestore.DocumentData>();
    for (const doc of tasksSnap.docs) {
      const d = doc.data();
      if (d.stageId) tasksByStageId.set(d.stageId as string, d);
    }

    // Build the summary: one entry per stage in the deliverable's snapshot.
    const stageSummary = stages.map((stage) => {
      const task = tasksByStageId.get(stage.id);
      if (!task) {
        return {
          stageId: stage.id,
          name: stage.name,
          status: "backlog" as TaskStatus,
          assigneeUid: "",
          assigneeName: "",
          dueAt: null,
        };
      }
      return {
        stageId: stage.id,
        name: stage.name,
        status: task.status as TaskStatus,
        assigneeUid: (task.assigneeUid as string) ?? "",
        assigneeName: (task.assigneeName as string) ?? "",
        dueAt: task.dueAt ?? null,
      };
    });

    await deliverableRef.update({ stageSummary });

    logger.info("stageSummary updated", {
      deliverableId,
      taskId: event.params.taskId,
      stageCount: stageSummary.length,
    });
  }
);
