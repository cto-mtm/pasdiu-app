// rebuildStageSummary() called directly — Firestore triggers never fire in
// the one-shot firestore-only run (docs/testing.md), so onTaskWrite stays a
// thin wrapper and the projection logic is tested as a plain function, the
// same pattern as reconcileOrg in test/reconcile.test.ts.
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import { rebuildStageSummary } from "../src/helpers/deliverableProjections.js";
import {
  clearFirestore,
  seedOrg,
  seedMember,
  seedDeliverable,
  seedTask,
} from "./helpers.js";

const ORG = "org-proj";
const DEL = "del-proj";

// seedDeliverable's default stage snapshot: s_capture, s_edit, s_review.

describe("rebuildStageSummary", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedOrg(ORG);
    await seedMember(ORG, "u-cap", "contractor", { displayName: "Casey Capture" });
    await seedMember(ORG, "u-edit", "contractor", { displayName: "Eddie Edit" });
    await seedDeliverable(ORG, DEL);
  });

  it("resolves assigneeName from member docs (tasks carry only assigneeUid)", async () => {
    const due = new Date("2026-08-20T12:00:00.000Z");
    await seedTask(ORG, "t-cap", {
      deliverableId: DEL, stageId: "s_capture", status: "done", assigneeUid: "u-cap",
    });
    await seedTask(ORG, "t-edit", {
      deliverableId: DEL, stageId: "s_edit", status: "in_progress", assigneeUid: "u-edit", dueAt: due,
    });
    // s_review has no task on purpose.

    const db = getFirestore();
    const result = await rebuildStageSummary(db, DEL);
    assert.deepEqual(result, { stageCount: 3 });

    const summary = (await db.doc(`deliverables/${DEL}`).get())
      .get("stageSummary") as Array<Record<string, unknown>>;
    assert.equal(summary.length, 3);

    assert.equal(summary[0].stageId, "s_capture");
    assert.equal(summary[0].status, "done");
    assert.equal(summary[0].assigneeUid, "u-cap");
    assert.equal(summary[0].assigneeName, "Casey Capture");

    assert.equal(summary[1].stageId, "s_edit");
    assert.equal(summary[1].status, "in_progress");
    assert.equal(summary[1].assigneeName, "Eddie Edit");
    assert.equal(
      (summary[1].dueAt as FirebaseFirestore.Timestamp).toDate().toISOString(),
      due.toISOString()
    );

    // A stage with no task reads as untouched backlog.
    assert.deepEqual(summary[2], {
      stageId: "s_review", name: "Review", status: "backlog",
      assigneeUid: "", assigneeName: "", dueAt: null,
    });
  });

  it("does not blank names an earlier write populated (seed.mjs regression)", async () => {
    // seed.mjs ships deliverables with display names already in the summary;
    // the first task write used to rebuild assigneeName from a field task
    // docs never carry, wiping every name to "".
    await seedDeliverable(ORG, DEL, {
      stageSummary: [
        { stageId: "s_capture", name: "Capture", status: "in_progress", assigneeUid: "u-cap", assigneeName: "Casey Capture", dueAt: null },
        { stageId: "s_edit", name: "Edit", status: "backlog", assigneeUid: "u-edit", assigneeName: "Eddie Edit", dueAt: null },
        { stageId: "s_review", name: "Review", status: "backlog", assigneeUid: "", assigneeName: "", dueAt: null },
      ],
    });
    await seedTask(ORG, "t-cap", {
      deliverableId: DEL, stageId: "s_capture", status: "in_progress", assigneeUid: "u-cap", dueAt: null,
    });
    await seedTask(ORG, "t-edit", {
      deliverableId: DEL, stageId: "s_edit", status: "backlog", assigneeUid: "u-edit", dueAt: null,
    });

    const db = getFirestore();
    await rebuildStageSummary(db, DEL);

    const summary = (await db.doc(`deliverables/${DEL}`).get())
      .get("stageSummary") as Array<Record<string, unknown>>;
    assert.equal(summary[0].assigneeName, "Casey Capture");
    assert.equal(summary[1].assigneeName, "Eddie Edit");
  });

  it("falls back to \"\" for unknown or empty assignee uids", async () => {
    await seedTask(ORG, "t-ghost", {
      deliverableId: DEL, stageId: "s_capture", status: "in_progress", assigneeUid: "u-departed",
    });
    await seedTask(ORG, "t-none", {
      deliverableId: DEL, stageId: "s_edit", status: "backlog", assigneeUid: "",
    });

    const db = getFirestore();
    await rebuildStageSummary(db, DEL);

    const summary = (await db.doc(`deliverables/${DEL}`).get())
      .get("stageSummary") as Array<Record<string, unknown>>;
    assert.equal(summary[0].assigneeUid, "u-departed"); // uid kept…
    assert.equal(summary[0].assigneeName, "");          // …name unresolvable
    assert.equal(summary[1].assigneeUid, "");
    assert.equal(summary[1].assigneeName, "");
  });

  it("returns null (and writes nothing) for a missing deliverable", async () => {
    const db = getFirestore();
    const result = await rebuildStageSummary(db, "del-nope");
    assert.equal(result, null);
    assert.equal((await db.doc("deliverables/del-nope").get()).exists, false);
  });
});
