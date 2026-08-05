import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { rebuildStageSummary } from "../helpers/deliverableProjections.js";

// Trigger: when a task with a deliverableId is created/updated/deleted,
// re-derive the parent deliverable's stageSummary. This is a DISPLAY CACHE —
// the tasks remain the authority (see docs/deliverables/phase-1-domain-foundation.md § 3).
// The rebuild itself lives in helpers/deliverableProjections.ts so the
// one-shot test suite (where triggers never fire) can call it directly.
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

    const result = await rebuildStageSummary(getFirestore(), deliverableId);

    if (!result) {
      logger.warn("onTaskWrite: deliverable not found, skipping summary update", {
        deliverableId,
        taskId: event.params.taskId,
      });
      return;
    }

    logger.info("stageSummary updated", {
      deliverableId,
      taskId: event.params.taskId,
      stageCount: result.stageCount,
    });
  }
);
