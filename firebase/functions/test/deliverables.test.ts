// Integration tests for POST /orgs/:orgId/deliverables/batch.
// Coverage matrix (per docs/testing.md):
//   - 401 unauthenticated
//   - 403 unverified email
//   - 403 wrong org
//   - 403 insufficient role (contractor, client)
//   - 409 over-limit
//   - 201 happy path with response-shape assertions
//   - side-effect assertions on Firestore state
//   - chunking case (>500 ops)
// Runner note: these register with vitest (see package.json "test"). Importing
// describe/it from node:test instead makes the whole file silently register
// zero tests under `vitest run`.
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import { rebuildStageSummary } from "../src/helpers/deliverableProjections.js";
import {
  post, postAnon, del, delAnon, clearFirestore, makeUserToken,
  seedOrg, seedMember, seedUsage, seedClient,
  seedDeliverable, seedDeliverableVersion, seedTask,
} from "./helpers.js";

describe("POST /orgs/:orgId/deliverables/batch", () => {
  const ORG = "org-batch";
  const PROJECT = "p-batch";
  let mgrToken: string;
  let contractorToken: string;
  let clientToken: string;
  let unverifiedToken: string;

  beforeEach(async () => {
    await clearFirestore();

    // Seed org with pipeline and limits.
    await seedOrg(ORG, {
      ownerUid: "u-mgr",
      deliverableLimit: 100,
      pipeline: {
        stages: [
          { id: "s_capture", name: "Capture", optional: false, clientFacing: false },
          { id: "s_edit", name: "Edit", optional: false, clientFacing: false },
          { id: "s_review", name: "Review", optional: false, clientFacing: true },
        ],
      },
    });
    await seedMember(ORG, "u-mgr", "admin");
    await seedMember(ORG, "u-contractor", "contractor");
    await seedMember(ORG, "u-client", "client", { clientId: "c-batch" });
    await seedUsage(ORG, { activeDeliverables: 0 });

    // Seed project + sub-group + client.
    const db = getFirestore();
    await db.doc(`projects/${PROJECT}`).set({
      orgId: ORG, clientId: "c-batch", name: "Batch Project",
      defaultView: "kanban", brief: { brandGuidelinesUrl: "", sopUrl: "", links: [], fields: [] }, meta: [],
    });
    await db.doc(`subGroups/sg-batch`).set({
      orgId: ORG, projectId: PROJECT, name: "July", order: 0, meta: [],
    });
    await seedClient(ORG, "c-batch");

    // Deliverable type.
    await db.doc(`deliverableTypes/dt-short`).set({
      orgId: ORG, name: "Short", weight: 3, order: 0,
    });

    // Tokens.
    mgrToken = await makeUserToken({ uid: "u-mgr", email: "mgr@batch.test" });
    contractorToken = await makeUserToken({ uid: "u-contractor", email: "con@batch.test" });
    clientToken = await makeUserToken({ uid: "u-client", email: "cl@batch.test" });
    unverifiedToken = await makeUserToken({ uid: "u-unverified", email: "unv@batch.test", emailVerified: false });
  });

  it("401 unauthenticated", async () => {
    const res = await postAnon(`/orgs/${ORG}/deliverables/batch`, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["Video 1"],
    });
    assert.equal(res.status, 401);
  });

  it("403 unverified email", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, unverifiedToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["Video 1"],
    });
    assert.equal(res.status, 403);
  });

  it("403 wrong org (not a member)", async () => {
    const outsiderToken = await makeUserToken({ uid: "u-outsider", email: "out@batch.test" });
    const res = await post(`/orgs/${ORG}/deliverables/batch`, outsiderToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["Video 1"],
    });
    assert.equal(res.status, 403);
  });

  it("403 contractor role", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, contractorToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["Video 1"],
    });
    assert.equal(res.status, 403);
  });

  it("403 client role", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, clientToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["Video 1"],
    });
    assert.equal(res.status, 403);
  });

  it("400 invalid body (missing names)", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
    });
    assert.equal(res.status, 400);
  });

  it("409 over deliverable limit", async () => {
    // Set usage to 99 with limit 100 — creating 5 would exceed.
    await getFirestore().doc(`orgs/${ORG}/usage/current`).update({ activeDeliverables: 99 });
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short",
      names: ["V1", "V2", "V3", "V4", "V5"],
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /deliverable_limit/);

    // Verify nothing was written.
    const db = getFirestore();
    const delSnap = await db.collection("deliverables").where("orgId", "==", ORG).get();
    assert.equal(delSnap.size, 0);
  });

  it("201 happy path — creates deliverables + stage tasks", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupId: "sg-batch",
      typeId: "dt-short",
      names: ["Video 1", "Video 2", "Video 3"],
      stageAssignees: {
        s_capture: ["u-contractor"],
        s_edit: ["u-contractor", "u-mgr"],
      },
      clientVisible: true,
      dueEndAt: "2026-08-15",
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.deliverableCount, 3);
    assert.equal(res.body.taskCount, 9); // 3 deliverables × 3 stages
    assert.equal(res.body.deliverableIds.length, 3);
    assert.equal(res.body.subGroupId, "sg-batch");
    assert.ok(res.body.assigneeCounts);

    // Verify Firestore state.
    const db = getFirestore();

    // Deliverables created with correct fields.
    const delSnap = await db.collection("deliverables").where("orgId", "==", ORG).get();
    assert.equal(delSnap.size, 3);
    const del0 = delSnap.docs.find((d) => d.get("name") === "Video 1")!;
    assert.equal(del0.get("clientId"), "c-batch");
    assert.equal(del0.get("projectId"), PROJECT);
    assert.equal(del0.get("subGroupId"), "sg-batch");
    assert.equal(del0.get("clientVisible"), true);
    assert.equal(del0.get("status"), "active");
    // Priority was omitted from the body — the schema default must land as a
    // real value, not `undefined` (Firestore rejects that and 500s the batch).
    assert.equal(del0.get("priority"), "normal");
    // Stage snapshot present.
    const stages = del0.get("stages") as unknown[];
    assert.equal(stages.length, 3);
    // Latest-cut projection starts empty (the onVersionWrite trigger owns it).
    assert.equal(del0.get("latestVersionUrl"), "");
    assert.equal(del0.get("latestVersionLabel"), "");

    // stageSummary prefilled with assignee display names resolved from member
    // docs — board rows render names immediately, without a member lookup and
    // without waiting for the onTaskWrite trigger.
    const summary0 = del0.get("stageSummary") as Array<Record<string, unknown>>;
    assert.equal(summary0.length, 3);
    assert.equal(summary0[0].stageId, "s_capture");
    assert.equal(summary0[0].status, "backlog");
    assert.equal(summary0[0].assigneeUid, "u-contractor");
    assert.equal(summary0[0].assigneeName, "Test u-contractor"); // seedMember default
    // Unassigned stage (no stageAssignees entry for s_review).
    assert.equal(summary0[2].assigneeUid, "");
    assert.equal(summary0[2].assigneeName, "");
    // Round-robin lands u-mgr on Video 2's edit stage — name follows the uid.
    const del1 = delSnap.docs.find((d) => d.get("name") === "Video 2")!;
    const summary1 = del1.get("stageSummary") as Array<Record<string, unknown>>;
    assert.equal(summary1[1].assigneeUid, "u-mgr");
    assert.equal(summary1[1].assigneeName, "Test u-mgr");

    // Tasks created (3 stages × 3 deliverables = 9).
    const taskSnap = await db.collection("tasks").where("orgId", "==", ORG).get();
    assert.equal(taskSnap.size, 9);

    // Stage summary is prefilled at creation — complete before any trigger
    // runs (and byte-identical to what onTaskWrite rebuilds), so the portal
    // renders progress immediately. Each entry points at its real stage task.
    const summary = del0.get("stageSummary") as Array<Record<string, unknown>>;
    assert.deepEqual(summary.map((e) => e.stageId), ["s_capture", "s_edit", "s_review"]);
    const taskById = new Map(taskSnap.docs.map((d) => [d.id, d]));
    for (const entry of summary) {
      assert.equal(entry.status, "backlog");
      assert.equal(entry.clientVisible, false);
      const task = taskById.get(entry.taskId as string);
      assert.ok(task, `summary entry ${entry.stageId} must reference a real task`);
      assert.equal(task.get("stageId"), entry.stageId);
      assert.equal(task.get("deliverableId"), del0.id);
      assert.equal(task.get("assigneeUid"), entry.assigneeUid);
    }

    // Check round-robin assignment on "Edit" stage.
    // Sort by `order`: the query has no orderBy, so Firestore returns docs by
    // document id — random auto-ids, i.e. an arbitrary order relative to the
    // round-robin this asserts.
    const editTasks = taskSnap.docs
      .filter((d) => d.get("stageId") === "s_edit")
      .sort((a, b) => (a.get("order") as number) - (b.get("order") as number));
    assert.equal(editTasks.length, 3);
    const editAssignees = editTasks.map((d) => d.get("assigneeUid"));
    // Round-robin: [u-contractor, u-mgr, u-contractor]
    assert.equal(editAssignees[0], "u-contractor");
    assert.equal(editAssignees[1], "u-mgr");
    assert.equal(editAssignees[2], "u-contractor");

    // Usage counter incremented.
    const usageSnap = await db.doc(`orgs/${ORG}/usage/current`).get();
    assert.equal(usageSnap.get("activeDeliverables"), 3);
  });

  it("applies an explicit priority to every deliverable in the batch", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupId: "sg-batch",
      names: ["Rush 1", "Rush 2"],
      priority: "high",
    });

    assert.equal(res.status, 201);
    const db = getFirestore();
    const snap = await db.collection("deliverables").where("orgId", "==", ORG).get();
    assert.equal(snap.size, 2);
    // One priority per batch — every deliverable carries it, not just the first.
    for (const d of snap.docs) assert.equal(d.get("priority"), "high");
  });

  it("400 rejects a priority outside the enum", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupId: "sg-batch",
      names: ["Nope"],
      priority: "urgent",
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_body");

    // Nothing written.
    const db = getFirestore();
    const snap = await db.collection("deliverables").where("orgId", "==", ORG).get();
    assert.equal(snap.size, 0);
  });

  it("201 creates a new sub-group when subGroupName is provided", async () => {
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupName: "August",
      typeId: "dt-short",
      names: ["Clip 1"],
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.subGroupId);
    assert.notEqual(res.body.subGroupId, "sg-batch");

    // Verify sub-group was created.
    const db = getFirestore();
    const sgSnap = await db.doc(`subGroups/${res.body.subGroupId}`).get();
    assert.ok(sgSnap.exists);
    assert.equal(sgSnap.get("name"), "August");
    assert.equal(sgSnap.get("orgId"), ORG);
  });

  // Only optional stages may be skipped — flips one in the seeded pipeline.
  async function markStageOptional(stageId: string): Promise<void> {
    const db = getFirestore();
    const snap = await db.doc(`orgs/${ORG}`).get();
    const stages = (snap.get("pipeline").stages as Array<Record<string, unknown>>).map((s) => (
      s.id === stageId ? { ...s, optional: true } : s
    ));
    await db.doc(`orgs/${ORG}`).update({ pipeline: { stages } });
  }

  it("400 when skipping a stage that is not optional", async () => {
    // A required stage with no task reads as the deliverable's current stage
    // forever, so the endpoint refuses rather than creating wedged work.
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      skipStageIds: ["s_review"],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /stage_not_optional/);
    assert.deepEqual(res.body.details, { stageIds: ["s_review"] });

    // Nothing written.
    const delSnap = await getFirestore().collection("deliverables").where("orgId", "==", ORG).get();
    assert.equal(delSnap.size, 0);
  });

  it("201 respects skipStageIds", async () => {
    await markStageOptional("s_review");
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupId: "sg-batch",
      typeId: "dt-short",
      names: ["No Review"],
      skipStageIds: ["s_review"],
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.taskCount, 2); // Only capture + edit

    const db = getFirestore();
    const taskSnap = await db.collection("tasks")
      .where("deliverableId", "==", res.body.deliverableIds[0])
      .get();
    assert.equal(taskSnap.size, 2);
    const stageIds = taskSnap.docs.map((d) => d.get("stageId"));
    assert.ok(stageIds.includes("s_capture"));
    assert.ok(stageIds.includes("s_edit"));
    assert.ok(!stageIds.includes("s_review"));

    // The skipped stage gets NO summary entry — a backlog placeholder would
    // read as the current stage forever (see rebuildStageSummary).
    const delSnap = await db.doc(`deliverables/${res.body.deliverableIds[0]}`).get();
    const summary = delSnap.get("stageSummary") as Array<Record<string, unknown>>;
    assert.deepEqual(summary.map((e) => e.stageId), ["s_capture", "s_edit"]);
  });

  it("stageSummary prefill is byte-identical to a trigger rebuild", async () => {
    // The onTaskWrite trigger rebuilds the summary from the tasks on every
    // stage transition; if the endpoint's prefill drifted from that shape,
    // the first transition would silently rewrite what the board renders.
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT,
      subGroupId: "sg-batch",
      names: ["Parity 1", "Parity 2"],
      stageAssignees: { s_capture: ["u-contractor"], s_edit: ["u-contractor", "u-mgr"] },
      dueEndAt: "2026-08-15",
    });
    assert.equal(res.status, 201);

    const db = getFirestore();
    for (const id of res.body.deliverableIds as string[]) {
      const ref = db.doc(`deliverables/${id}`);
      const prefill = (await ref.get()).get("stageSummary");
      const result = await rebuildStageSummary(db, id);
      assert.equal(result.updated, true);
      const rebuilt = (await ref.get()).get("stageSummary");
      assert.deepEqual(rebuilt, prefill);
    }
  });

  // ── Stage scheduling ──────────────────────────────────────────────────────
  // Stage durations chain along the pipeline to give each stage task its own
  // deadline, anchored on the deliverable's date. See the batch route.

  // Rewrites the seeded pipeline with per-stage durations (hours).
  async function setStageDurations(durations: Record<string, number>): Promise<void> {
    const db = getFirestore();
    const snap = await db.doc(`orgs/${ORG}`).get();
    const stages = (snap.get("pipeline").stages as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      durationHours: durations[s.id as string] ?? 0,
    }));
    await db.doc(`orgs/${ORG}`).update({ pipeline: { stages } });
  }

  // stageId → dueAt as an ISO string, for the given deliverable.
  async function dueAtByStage(deliverableId: string): Promise<Record<string, string>> {
    const snap = await getFirestore().collection("tasks")
      .where("deliverableId", "==", deliverableId).get();
    const out: Record<string, string> = {};
    for (const d of snap.docs) {
      const due = d.get("dueAt");
      out[d.get("stageId") as string] = due ? due.toDate().toISOString() : "";
    }
    return out;
  }

  it("no stage durations → every task falls on the deliverable date", async () => {
    // The seeded pipeline carries no durationHours at all, which is exactly
    // the shape of an org doc written before durations existed.
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-15",
    });
    assert.equal(res.status, 201);

    const due = await dueAtByStage(res.body.deliverableIds[0]);
    assert.equal(due.s_capture, "2026-08-15T12:00:00.000Z");
    assert.equal(due.s_edit, "2026-08-15T12:00:00.000Z");
    assert.equal(due.s_review, "2026-08-15T12:00:00.000Z");
  });

  it("scheduleMode 'end' back-schedules so the last stage lands on the date", async () => {
    await setStageDurations({ s_capture: 24, s_edit: 48, s_review: 24 }); // 96h total
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-15", scheduleMode: "end",
    });
    assert.equal(res.status, 201);

    const due = await dueAtByStage(res.body.deliverableIds[0]);
    assert.equal(due.s_capture, "2026-08-12T12:00:00.000Z"); // anchor − 72h
    assert.equal(due.s_edit, "2026-08-14T12:00:00.000Z"); // anchor − 24h
    assert.equal(due.s_review, "2026-08-15T12:00:00.000Z"); // the anchor itself
  });

  it("scheduleMode 'start' runs the stages forward from the date", async () => {
    await setStageDurations({ s_capture: 48, s_edit: 48, s_review: 24 });
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-01", scheduleMode: "start",
    });
    assert.equal(res.status, 201);

    const due = await dueAtByStage(res.body.deliverableIds[0]);
    // A 2-day first stage is due 2 days after the start date.
    assert.equal(due.s_capture, "2026-08-03T12:00:00.000Z"); // +48h
    assert.equal(due.s_edit, "2026-08-05T12:00:00.000Z"); // +96h
    assert.equal(due.s_review, "2026-08-06T12:00:00.000Z"); // +120h
  });

  it("scheduleMode defaults to 'end' when omitted", async () => {
    await setStageDurations({ s_capture: 24, s_edit: 48, s_review: 24 });
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-15",
    });
    assert.equal(res.status, 201);

    const due = await dueAtByStage(res.body.deliverableIds[0]);
    assert.equal(due.s_review, "2026-08-15T12:00:00.000Z");
    assert.equal(due.s_capture, "2026-08-12T12:00:00.000Z");
  });

  it("skipped stages consume no schedule time", async () => {
    await setStageDurations({ s_capture: 24, s_edit: 48, s_review: 24 });
    await markStageOptional("s_edit");
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-01", scheduleMode: "start", skipStageIds: ["s_edit"],
    });
    assert.equal(res.status, 201);

    const due = await dueAtByStage(res.body.deliverableIds[0]);
    // Edit's 48h is skipped entirely: review follows capture directly.
    assert.equal(due.s_capture, "2026-08-02T12:00:00.000Z"); // +24h
    assert.equal(due.s_review, "2026-08-03T12:00:00.000Z"); // +48h
    assert.equal(due.s_edit, undefined);
  });

  it("malformed durationHours degrade to 0 instead of failing the batch", async () => {
    // The rules gate WHICH keys change on an org doc, never the pipeline's
    // contents, so junk can legitimately reach this endpoint. Uncoerced it
    // would produce an Invalid Date and take the whole batch write down.
    const db = getFirestore();
    const snap = await db.doc(`orgs/${ORG}`).get();
    const stages = (snap.get("pipeline").stages as Array<Record<string, unknown>>).map((s, i) => ({
      ...s,
      durationHours: [("nonsense" as unknown), -5, 24][i],
    }));
    await db.doc(`orgs/${ORG}`).update({ pipeline: { stages } });

    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1"],
      dueEndAt: "2026-08-15", scheduleMode: "end",
    });
    assert.equal(res.status, 201);

    // Only the valid 24h counts, so the first two stages sit 24h before review.
    const due = await dueAtByStage(res.body.deliverableIds[0]);
    assert.equal(due.s_capture, "2026-08-14T12:00:00.000Z");
    assert.equal(due.s_edit, "2026-08-14T12:00:00.000Z");
    assert.equal(due.s_review, "2026-08-15T12:00:00.000Z");
  });

  it("stage schedules ride on each deliverable's own anchor across a window", async () => {
    await setStageDurations({ s_capture: 24, s_edit: 24, s_review: 24 }); // 72h
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", names: ["V1", "V2", "V3"],
      dueStartAt: "2026-08-01", dueEndAt: "2026-08-31", scheduleMode: "end",
    });
    assert.equal(res.status, 201);

    const db = getFirestore();
    const delSnap = await db.collection("deliverables").where("orgId", "==", ORG).get();
    const idOf = (name: string) => delSnap.docs.find((d) => d.get("name") === name)!.id;

    // Anchors interpolate across the window (Aug 1 / Aug 16 / Aug 31), and
    // each deliverable's stages back-schedule from its own anchor.
    const first = await dueAtByStage(idOf("V1"));
    const last = await dueAtByStage(idOf("V3"));
    assert.equal(first.s_review, "2026-08-01T12:00:00.000Z");
    assert.equal(first.s_capture, "2026-07-30T12:00:00.000Z"); // −48h
    assert.equal(last.s_review, "2026-08-31T12:00:00.000Z");
    assert.equal(last.s_capture, "2026-08-29T12:00:00.000Z"); // −48h
  });

  it("unlimited (-1) limit allows any count", async () => {
    await getFirestore().doc(`orgs/${ORG}`).update({ deliverableLimit: -1 });
    const names = Array.from({ length: 50 }, (_, i) => `Vid ${i + 1}`);
    const res = await post(`/orgs/${ORG}/deliverables/batch`, mgrToken, {
      projectId: PROJECT, subGroupId: "sg-batch", typeId: "dt-short", names,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.deliverableCount, 50);
  });
});

// Deleting a wrongly-created deliverable: cascades to its stage tasks and
// their subcollections, and decrements activeDeliverables (but never
// activeTasks — stage tasks were never counted there). Coverage matrix per
// docs/testing.md.
describe("DELETE /orgs/:orgId/deliverables/:deliverableId", () => {
  const ORG = "org-del";
  const PROJECT = "p-del";
  let mgrToken: string;
  let contractorToken: string;
  let clientToken: string;
  let unverifiedToken: string;

  beforeEach(async () => {
    await clearFirestore();

    await seedOrg(ORG, { ownerUid: "u-mgr", deliverableLimit: 100 });
    await seedMember(ORG, "u-mgr", "admin");
    await seedMember(ORG, "u-contractor", "contractor");
    await seedMember(ORG, "u-client", "client", { clientId: "c-del" });
    // activeTasks seeded non-zero to prove the delete leaves it untouched.
    await seedUsage(ORG, { activeDeliverables: 1, activeTasks: 4 });
    await seedClient(ORG, "c-del");

    // One deliverable with three stage tasks + a couple of subcollection docs
    // to prove the cascade reaches them.
    await seedDeliverable(ORG, "d-1", {
      clientId: "c-del", projectId: PROJECT, subGroupId: "sg-del", status: "active",
    });
    await seedDeliverableVersion("d-1", "v-1");
    for (const [i, sid] of ["s_capture", "s_edit", "s_review"].entries()) {
      await seedTask(ORG, `t-${sid}`, {
        clientId: "c-del", projectId: PROJECT, subGroupId: "sg-del",
        deliverableId: "d-1", stageId: sid, order: i,
      });
    }
    // A note under one of the stage tasks — must be gone after the cascade.
    await getFirestore().doc(`tasks/t-s_capture/notes/n-1`).set({
      versionId: "", authorUid: "u-mgr", body: "take 2", resolved: false, createdAt: new Date(),
    });

    mgrToken = await makeUserToken({ uid: "u-mgr", email: "mgr@del.test" });
    contractorToken = await makeUserToken({ uid: "u-contractor", email: "con@del.test" });
    clientToken = await makeUserToken({ uid: "u-client", email: "cl@del.test" });
    unverifiedToken = await makeUserToken({ uid: "u-unverified", email: "unv@del.test", emailVerified: false });
  });

  it("401 unauthenticated", async () => {
    const res = await delAnon(`/orgs/${ORG}/deliverables/d-1`);
    assert.equal(res.status, 401);
  });

  it("403 unverified email", async () => {
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, unverifiedToken);
    assert.equal(res.status, 403);
  });

  it("403 wrong org (not a member)", async () => {
    const outsiderToken = await makeUserToken({ uid: "u-outsider", email: "out@del.test" });
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, outsiderToken);
    assert.equal(res.status, 403);
  });

  it("403 contractor role", async () => {
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, contractorToken);
    assert.equal(res.status, 403);
  });

  it("403 client role", async () => {
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, clientToken);
    assert.equal(res.status, 403);
  });

  it("404 when the deliverable does not exist", async () => {
    const res = await del(`/orgs/${ORG}/deliverables/nope`, mgrToken);
    assert.equal(res.status, 404);
  });

  it("404 for another org's deliverable (no cross-org delete by id)", async () => {
    // A manager of ORG must not delete a deliverable that lives in another org,
    // even though they can name its id.
    await seedOrg("org-other", { ownerUid: "u-other" });
    await seedDeliverable("org-other", "d-other", { status: "active" });
    const res = await del(`/orgs/${ORG}/deliverables/d-other`, mgrToken);
    assert.equal(res.status, 404);

    // Untouched.
    const other = await getFirestore().doc(`deliverables/d-other`).get();
    assert.ok(other.exists);
  });

  it("200 cascades to stage tasks + subcollections and decrements activeDeliverables", async () => {
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, mgrToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.deliverableId, "d-1");
    assert.equal(res.body.taskCount, 3);

    const db = getFirestore();

    // Deliverable + its version subcollection gone.
    assert.equal((await db.doc(`deliverables/d-1`).get()).exists, false);
    assert.equal((await db.doc(`deliverables/d-1/versions/v-1`).get()).exists, false);

    // All three stage tasks gone, including the note subcollection.
    const remaining = await db.collection("tasks").where("deliverableId", "==", "d-1").get();
    assert.equal(remaining.size, 0);
    assert.equal((await db.doc(`tasks/t-s_capture/notes/n-1`).get()).exists, false);

    // activeDeliverables decremented; activeTasks untouched (stage tasks were
    // never counted there).
    const usage = await db.doc(`orgs/${ORG}/usage/current`).get();
    assert.equal(usage.get("activeDeliverables"), 0);
    assert.equal(usage.get("activeTasks"), 4);
  });

  it("does not decrement activeDeliverables for a non-active deliverable", async () => {
    // A delivered deliverable is no longer counted (reconcile filters on
    // status == 'active'), so removing it must leave the counter alone.
    await getFirestore().doc(`deliverables/d-1`).update({ status: "delivered" });
    const res = await del(`/orgs/${ORG}/deliverables/d-1`, mgrToken);
    assert.equal(res.status, 200);

    const usage = await getFirestore().doc(`orgs/${ORG}/usage/current`).get();
    assert.equal(usage.get("activeDeliverables"), 1);
  });
});
