// Migration: reparent versions from tasks to deliverables.
//
// Phase 1 § 6: versions are versions of the video, not of a stage. They move
// from tasks/{taskId}/versions/* to deliverables/{deliverableId}/versions/*.
// Notes linked to a version move to the deliverable; task-only notes stay.
//
// Strategy (idempotent, safe to re-run):
//   1. For each task that has versions AND no deliverableId yet:
//      a. Create a wrapping deliverable (or find one if it already exists for
//         this task's project + subGroup + order — matching means a previous
//         run already created it).
//      b. Copy version docs to the deliverable subcollection.
//      c. Copy version-linked notes to the deliverable subcollection.
//      d. Set deliverableId + stageId ("s_edit" default) on the task.
//   2. Recount activeDeliverables on each org's usage doc.
//
// DOES NOT DELETE source docs. Run this first, verify, then delete in a
// separate pass (see deleteSourceVersions below, disabled by default).
//
// Run against emulators:
//   cd firebase && node migrate-versions.mjs
//
// Run against production (CAUTION):
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json node migrate-versions.mjs

import admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-app" });
const db = admin.firestore();

// Default pipeline stage id to assign migrated tasks (they're all edit-stage
// tasks in the beta since the pipeline didn't exist before).
const DEFAULT_STAGE_ID = "s_edit";

// Default stage snapshot for migrated deliverables.
const DEFAULT_STAGES = [
  { id: "s_discovery", name: "Discovery", optional: true, clientFacing: false },
  { id: "s_capture", name: "Capture", optional: false, clientFacing: false },
  { id: "s_edit", name: "Edit", optional: false, clientFacing: false },
  { id: "s_review", name: "Review", optional: false, clientFacing: true },
  { id: "s_approval", name: "Approval", optional: false, clientFacing: true },
];

async function migrate() {
  const tasksSnap = await db.collection("tasks").get();
  let migratedCount = 0;
  let skippedCount = 0;
  const orgDeliverableCounts = new Map();

  for (const taskDoc of tasksSnap.docs) {
    const task = taskDoc.data();

    // Skip tasks that already have a deliverableId (already migrated or batch-created).
    if (task.deliverableId) {
      skippedCount++;
      continue;
    }

    // Check if this task has versions.
    const versionsSnap = await db
      .collection(`tasks/${taskDoc.id}/versions`)
      .get();

    if (versionsSnap.empty) {
      skippedCount++;
      continue;
    }

    // This task has versions and no deliverableId — create a wrapping deliverable.
    console.log(`  Migrating task ${taskDoc.id} (${task.title}) — ${versionsSnap.size} version(s)`);

    // Check if a deliverable already exists for this task (idempotent re-run).
    const existingDel = await db
      .collection("deliverables")
      .where("orgId", "==", task.orgId)
      .where("projectId", "==", task.projectId)
      .where("name", "==", task.title)
      .limit(1)
      .get();

    let deliverableId;
    if (!existingDel.empty) {
      deliverableId = existingDel.docs[0].id;
      console.log(`    → Found existing deliverable ${deliverableId}`);
    } else {
      // Look up the sub-group name for denormalization.
      let subGroupName = "";
      if (task.subGroupId) {
        const sgSnap = await db.doc(`subGroups/${task.subGroupId}`).get();
        if (sgSnap.exists) subGroupName = sgSnap.get("name") || "";
      }

      // Create the deliverable.
      const delRef = db.collection("deliverables").doc();
      deliverableId = delRef.id;
      await delRef.set({
        orgId: task.orgId,
        clientId: task.clientId || "",
        projectId: task.projectId || "",
        subGroupId: task.subGroupId || "",
        subGroupName,
        typeId: "", // unknown pre-migration
        stages: DEFAULT_STAGES,
        stageSummary: [],
        name: task.title,
        status: task.status === "done" || task.status === "approved" || task.status === "delivered"
          ? "delivered" : "active",
        clientVisible: task.clientVisible || false,
        latestVersionUrl: "",
        order: task.order || 0,
        meta: [],
        createdAt: task.createdAt || new Date(),
        deliveredAt: task.completedAt || null,
      });
      console.log(`    → Created deliverable ${deliverableId}`);

      // Track for usage recount.
      const orgId = task.orgId;
      orgDeliverableCounts.set(orgId, (orgDeliverableCounts.get(orgId) || 0) + 1);
    }

    // Copy versions to deliverable subcollection.
    for (const vDoc of versionsSnap.docs) {
      const targetRef = db.doc(`deliverables/${deliverableId}/versions/${vDoc.id}`);
      const existing = await targetRef.get();
      if (!existing.exists) {
        await targetRef.set(vDoc.data());
        console.log(`    → Copied version ${vDoc.id}`);
      }
    }

    // Copy version-linked notes to deliverable; leave task-only notes on the task.
    const notesSnap = await db.collection(`tasks/${taskDoc.id}/notes`).get();
    for (const nDoc of notesSnap.docs) {
      const note = nDoc.data();
      // A note is version-linked if it has a non-empty versionId.
      if (note.versionId) {
        const targetRef = db.doc(`deliverables/${deliverableId}/notes/${nDoc.id}`);
        const existing = await targetRef.get();
        if (!existing.exists) {
          await targetRef.set(note);
          console.log(`    → Copied version-linked note ${nDoc.id}`);
        }
      }
    }

    // Set deliverableId + stageId on the task.
    await taskDoc.ref.update({
      deliverableId,
      stageId: DEFAULT_STAGE_ID,
    });
    console.log(`    → Updated task with deliverableId=${deliverableId}, stageId=${DEFAULT_STAGE_ID}`);
    migratedCount++;
  }

  // Recount activeDeliverables for affected orgs.
  for (const [orgId] of orgDeliverableCounts) {
    const activeCount = await db
      .collection("deliverables")
      .where("orgId", "==", orgId)
      .where("status", "==", "active")
      .count()
      .get();
    await db.doc(`orgs/${orgId}/usage/current`).set(
      { activeDeliverables: activeCount.data().count },
      { merge: true }
    );
    console.log(`  → Reconciled activeDeliverables for ${orgId}: ${activeCount.data().count}`);
  }

  console.log(`\n✔ Migration complete: ${migratedCount} tasks migrated, ${skippedCount} skipped.`);
}

// Optional: delete source version/note docs AFTER verifying the copy.
// Uncomment and run separately after confirming the migration is correct.
// async function deleteSourceVersions() { ... }

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
