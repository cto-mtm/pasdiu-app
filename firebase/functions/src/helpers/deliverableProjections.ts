import type { Firestore } from "firebase-admin/firestore";
import type { TaskStatus } from "@pasdiu/shared";

// stageSummary is a DISPLAY CACHE on the deliverable — the tasks remain the
// authority (see docs/deliverables/data-modeling.md § "stageSummary on the
// deliverable"). The onTaskWrite trigger calls rebuildStageSummary to keep the
// summary mirroring the tasks; it lives here as a plain function because
// Firestore triggers never fire in the one-shot test run (docs/testing.md), so
// the logic is tested by calling it directly.

/**
 * Resolve member display names for a set of uids in one getAll round-trip.
 * Unknown, non-member, or empty uids resolve to "" — a rebuild must never fail
 * over a missing member doc (departed member, junk input).
 */
export async function resolveMemberNames(
  db: Firestore,
  orgId: string,
  uids: Iterable<string>
): Promise<Map<string, string>> {
  const distinct = [...new Set(uids)].filter((uid) => uid !== "");
  const names = new Map<string, string>();
  if (distinct.length === 0) return names;
  const snaps = await db.getAll(
    ...distinct.map((uid) => db.doc(`orgs/${orgId}/members/${uid}`))
  );
  for (const snap of snaps) {
    names.set(snap.id, snap.exists ? ((snap.get("displayName") as string) ?? "") : "");
  }
  return names;
}

/**
 * Re-derive a deliverable's stageSummary from its stage tasks: one entry per
 * stage in the deliverable's snapshot; stages with no task read as untouched
 * backlog. assigneeName is denormalized from orgs/{orgId}/members/{uid} —
 * task docs carry only assigneeUid, so resolving here is what keeps board
 * rows from needing a member lookup per row.
 *
 * Returns null (without writing) when the deliverable doesn't exist.
 */
export async function rebuildStageSummary(
  db: Firestore,
  deliverableId: string
): Promise<{ stageCount: number } | null> {
  const deliverableRef = db.doc(`deliverables/${deliverableId}`);
  const deliverableSnap = await deliverableRef.get();
  if (!deliverableSnap.exists) return null;

  const deliverable = deliverableSnap.data()!;
  const orgId = (deliverable.orgId as string) ?? "";
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

  const names = await resolveMemberNames(
    db,
    orgId,
    [...tasksByStageId.values()].map((t) => (t.assigneeUid as string) ?? "")
  );

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
    const assigneeUid = (task.assigneeUid as string) ?? "";
    return {
      stageId: stage.id,
      name: stage.name,
      status: task.status as TaskStatus,
      assigneeUid,
      assigneeName: names.get(assigneeUid) ?? "",
      dueAt: task.dueAt ?? null,
    };
  });

  await deliverableRef.update({ stageSummary });
  return { stageCount: stageSummary.length };
}
