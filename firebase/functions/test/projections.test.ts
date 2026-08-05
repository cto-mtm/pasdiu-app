// Trigger-maintained deliverable projections (stageSummary +
// latestVersionUrl/Label), tested as plain functions per docs/testing.md: the
// one-shot suite runs `--only firestore,auth`, so the onTaskWrite /
// onVersionWrite wrappers never fire there — the rebuild logic in
// src/helpers/deliverableProjections.ts is driven directly, like reconcileOrg.
// With the full emulator suite up (dev), the real triggers ALSO fire on the
// seed writes below — they rebuild to the exact same converged state, and the
// assertions poll where that background write could interleave.
// Runner note: these register with vitest (see package.json "test"). Importing
// describe/it from node:test instead makes the whole file silently register
// zero tests under `vitest run`.
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import {
  rebuildLatestVersion,
  rebuildStageSummary,
} from "../src/helpers/deliverableProjections.js";
import {
  clearFirestore,
  seedDeliverable,
  seedDeliverableVersion,
  seedTask,
  pollUntil,
} from "./helpers.js";

const ORG = "org-proj";
const DEL = "del-proj";

type Entry = Record<string, unknown>;

async function summaryOf(deliverableId: string): Promise<Entry[]> {
  const snap = await getFirestore().doc(`deliverables/${deliverableId}`).get();
  return (snap.get("stageSummary") as Entry[]) ?? [];
}

beforeEach(async () => {
  await clearFirestore();
});

describe("rebuildStageSummary", () => {
  it("builds one entry per stage, carrying taskId and clientVisible from the task", async () => {
    // Drifted summary on purpose — the rebuild must replace it wholesale.
    await seedDeliverable(ORG, DEL, {
      stageSummary: [
        { stageId: "s_capture", name: "stale", status: "done", assigneeUid: "", assigneeName: "", dueAt: null },
      ],
    });
    const due = new Date("2026-08-10T12:00:00.000Z");
    await seedTask(ORG, "t-capture", { deliverableId: DEL, stageId: "s_capture", status: "done", assigneeUid: "u-a", dueAt: due });
    await seedTask(ORG, "t-edit", { deliverableId: DEL, stageId: "s_edit", status: "in_progress", assigneeUid: "u-b" });
    await seedTask(ORG, "t-review", { deliverableId: DEL, stageId: "s_review", status: "backlog", assigneeUid: "", clientVisible: true });

    const result = await rebuildStageSummary(getFirestore(), DEL);
    assert.equal(result.updated, true);

    // The predicate pins the fully-converged state (in dev the live trigger
    // also rebuilds, and an in-flight run can briefly hold partial entries).
    const summary = await pollUntil(
      () => summaryOf(DEL),
      (s) => s.length === 3 && s[1]?.taskId === "t-edit" && s[2]?.taskId === "t-review"
    );
    // Snapshot order, one entry per stage.
    assert.deepEqual(summary.map((e) => e.stageId), ["s_capture", "s_edit", "s_review"]);
    assert.deepEqual(summary.map((e) => e.taskId), ["t-capture", "t-edit", "t-review"]);
    assert.deepEqual(summary.map((e) => e.status), ["done", "in_progress", "backlog"]);
    assert.deepEqual(summary.map((e) => e.assigneeUid), ["u-a", "u-b", ""]);
    // clientVisible mirrors each task — this is what the portal links chips by.
    assert.deepEqual(summary.map((e) => e.clientVisible), [false, false, true]);
    assert.equal((summary[0].dueAt as FirebaseFirestore.Timestamp).toMillis(), due.getTime());
    assert.equal(summary[0].name, "Capture"); // from the snapshot, not the stale entry
  });

  it("keeps a backlog placeholder (taskId '') for a required stage with no task", async () => {
    await seedDeliverable(ORG, DEL);
    await seedTask(ORG, "t-only-capture", { deliverableId: DEL, stageId: "s_capture", status: "done" });

    await rebuildStageSummary(getFirestore(), DEL);

    const summary = await pollUntil(() => summaryOf(DEL), (s) => s.length === 3);
    const edit = summary.find((e) => e.stageId === "s_edit")!;
    assert.equal(edit.status, "backlog");
    assert.equal(edit.taskId, "");
    assert.equal(edit.assigneeUid, "");
    assert.equal(edit.clientVisible, false);
    assert.equal(edit.dueAt, null);
  });

  it("omits an optional stage with no task (skipped at creation)", async () => {
    // Matches currentStage() in app/src/lib/deliverableStage.ts: a backlog
    // placeholder for a skipped stage would read as "current" forever.
    await seedDeliverable(ORG, DEL, {
      stages: [
        { id: "s_discovery", name: "Discovery", optional: true, clientFacing: false },
        { id: "s_capture", name: "Capture", optional: false, clientFacing: false },
      ],
    });
    await seedTask(ORG, "t-cap", { deliverableId: DEL, stageId: "s_capture", status: "in_progress" });

    await rebuildStageSummary(getFirestore(), DEL);

    const summary = await pollUntil(() => summaryOf(DEL), (s) => s.length === 1);
    assert.equal(summary[0].stageId, "s_capture");
    assert.equal(summary[0].taskId, "t-cap");
  });

  it("still summarizes an optional stage that DOES have a task", async () => {
    await seedDeliverable(ORG, DEL, {
      stages: [
        { id: "s_discovery", name: "Discovery", optional: true, clientFacing: false },
        { id: "s_capture", name: "Capture", optional: false, clientFacing: false },
      ],
    });
    await seedTask(ORG, "t-disc", { deliverableId: DEL, stageId: "s_discovery", status: "done" });
    await seedTask(ORG, "t-cap2", { deliverableId: DEL, stageId: "s_capture", status: "backlog" });

    await rebuildStageSummary(getFirestore(), DEL);

    const summary = await pollUntil(
      () => summaryOf(DEL),
      (s) => s.length === 2 && s[1]?.taskId === "t-cap2"
    );
    assert.deepEqual(summary.map((e) => e.stageId), ["s_discovery", "s_capture"]);
    assert.equal(summary[0].taskId, "t-disc");
    assert.equal(summary[0].status, "done");
    assert.equal(summary[1].taskId, "t-cap2");
  });

  it("returns updated:false (and does not throw) for a missing deliverable", async () => {
    const result = await rebuildStageSummary(getFirestore(), "del-ghost");
    assert.equal(result.updated, false);
  });
});

describe("rebuildLatestVersion", () => {
  it("stamps url + label from the newest version by createdAt", async () => {
    await seedDeliverable(ORG, DEL);
    // Seeded out of order — recency comes from createdAt, not write order.
    await seedDeliverableVersion(DEL, "v2", { createdAt: new Date("2026-08-02T10:00:00Z"), mediaUrl: "https://pasdiu.com/cuts/x-v2" });
    await seedDeliverableVersion(DEL, "v3", { createdAt: new Date("2026-08-03T10:00:00Z"), mediaUrl: "https://pasdiu.com/cuts/x-v3" });
    await seedDeliverableVersion(DEL, "v1", { createdAt: new Date("2026-08-01T10:00:00Z"), mediaUrl: "https://pasdiu.com/cuts/x-v1" });

    const result = await rebuildLatestVersion(getFirestore(), DEL);
    assert.equal(result.updated, true);

    const snap = await pollUntil(
      () => getFirestore().doc(`deliverables/${DEL}`).get(),
      (s) => s.get("latestVersionUrl") === "https://pasdiu.com/cuts/x-v3"
    );
    assert.equal(snap.get("latestVersionUrl"), "https://pasdiu.com/cuts/x-v3");
    assert.equal(snap.get("latestVersionLabel"), "v3");
  });

  it("clears both fields when no versions exist", async () => {
    await seedDeliverable(ORG, DEL, {
      latestVersionUrl: "https://pasdiu.com/cuts/stale",
      latestVersionLabel: "v9",
    });

    const result = await rebuildLatestVersion(getFirestore(), DEL);
    assert.equal(result.updated, true);

    const snap = await getFirestore().doc(`deliverables/${DEL}`).get();
    assert.equal(snap.get("latestVersionUrl"), "");
    assert.equal(snap.get("latestVersionLabel"), "");
  });

  it("returns updated:false (and does not throw) for a missing deliverable", async () => {
    const result = await rebuildLatestVersion(getFirestore(), "del-ghost");
    assert.equal(result.updated, false);
  });
});
