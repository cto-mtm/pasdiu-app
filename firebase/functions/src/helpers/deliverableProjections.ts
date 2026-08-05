import type { Firestore } from "firebase-admin/firestore";
import type { TaskStatus } from "@pasdiu/shared";

// Trigger-maintained projections on the deliverable doc (display caches — the
// tasks/versions subdocs remain the authority; see docs/deliverables/
// data-modeling.md). Plain functions, not trigger handlers: the emulator's
// one-shot test run is firestore-only (docs/testing.md), so trigger logic must
// be callable directly, exactly like reconcileOrg. The onTaskWrite /
// onVersionWrite wrappers in ../triggers/ stay thin.

export interface RebuildResult {
  /** False when the deliverable doc doesn't exist (nothing to update). */
  updated: boolean;
}

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
 * Re-derive `stageSummary` from the deliverable's stage snapshot + its tasks.
 * One entry per instantiated stage, carrying enough that list views and the
 * portal never need a second read (taskId + clientVisible let stage chips
 * link into the Iteration Room without a task query; assigneeName is resolved
 * from orgs/{orgId}/members/{uid} — task docs carry only assigneeUid — so
 * board rows never pay a member lookup).
 *
 * Mirrors currentStage() in app/src/lib/deliverableStage.ts: an optional
 * stage with no task was skipped at creation and gets NO entry (a backlog
 * placeholder would read as the current stage forever); a required stage with
 * no task IS current (awaiting instantiation) and gets a placeholder.
 */
export async function rebuildStageSummary(
  db: Firestore,
  deliverableId: string
): Promise<RebuildResult> {
  const deliverableRef = db.doc(`deliverables/${deliverableId}`);
  const deliverableSnap = await deliverableRef.get();
  if (!deliverableSnap.exists) return { updated: false };

  const deliverable = deliverableSnap.data()!;
  const orgId = (deliverable.orgId as string) ?? "";
  const stages = (deliverable.stages ?? []) as Array<{
    id: string;
    name: string;
    optional?: boolean;
  }>;

  // Load all tasks for this deliverable to rebuild the full summary.
  const tasksSnap = await db
    .collection("tasks")
    .where("deliverableId", "==", deliverableId)
    .get();

  const tasksByStageId = new Map<
    string,
    { id: string; data: FirebaseFirestore.DocumentData }
  >();
  for (const doc of tasksSnap.docs) {
    const d = doc.data();
    if (d.stageId) tasksByStageId.set(d.stageId as string, { id: doc.id, data: d });
  }

  const names = await resolveMemberNames(
    db,
    orgId,
    [...tasksByStageId.values()].map((t) => (t.data.assigneeUid as string) ?? "")
  );

  const stageSummary = stages.flatMap((stage) => {
    const task = tasksByStageId.get(stage.id);
    if (!task) {
      // Optional + no task = skipped at creation: no entry.
      if (stage.optional === true) return [];
      return [
        {
          stageId: stage.id,
          name: stage.name,
          status: "backlog" as TaskStatus,
          assigneeUid: "",
          assigneeName: "",
          dueAt: null,
          taskId: "",
          clientVisible: false,
        },
      ];
    }
    const assigneeUid = (task.data.assigneeUid as string) ?? "";
    return [
      {
        stageId: stage.id,
        name: stage.name,
        status: task.data.status as TaskStatus,
        assigneeUid,
        assigneeName: names.get(assigneeUid) ?? "",
        dueAt: task.data.dueAt ?? null,
        taskId: task.id,
        clientVisible: (task.data.clientVisible as boolean) ?? false,
      },
    ];
  });

  await deliverableRef.update({ stageSummary });
  return { updated: true };
}

/**
 * Re-derive `latestVersionUrl` + `latestVersionLabel` from the deliverable's
 * versions subcollection — newest version by createdAt wins; no versions
 * clears both to ''. This is what keeps the portal's "Watch the latest cut"
 * button current when the Iteration Room adds a version (the client SDK can't
 * write the deliverable doc — see firestore.rules).
 */
export async function rebuildLatestVersion(
  db: Firestore,
  deliverableId: string
): Promise<RebuildResult> {
  const deliverableRef = db.doc(`deliverables/${deliverableId}`);
  const deliverableSnap = await deliverableRef.get();
  if (!deliverableSnap.exists) return { updated: false };

  // Versions are few (v1, v2, …) — read them all and pick the newest, rather
  // than orderBy(createdAt) which silently drops docs missing the field.
  const versionsSnap = await deliverableRef.collection("versions").get();
  let latest: FirebaseFirestore.DocumentData | null = null;
  let latestMillis = -1;
  for (const doc of versionsSnap.docs) {
    const d = doc.data();
    const millis = d.createdAt?.toMillis?.() ?? 0;
    if (millis >= latestMillis) {
      latestMillis = millis;
      latest = d;
    }
  }

  await deliverableRef.update({
    latestVersionUrl: (latest?.mediaUrl as string) ?? "",
    latestVersionLabel: (latest?.label as string) ?? "",
  });
  return { updated: true };
}
