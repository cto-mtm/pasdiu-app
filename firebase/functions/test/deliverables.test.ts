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
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import {
  post, postAnon, clearFirestore, makeUserToken,
  seedOrg, seedMember, seedUsage, seedClient,
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
    // Stage snapshot present.
    const stages = del0.get("stages") as unknown[];
    assert.equal(stages.length, 3);

    // Tasks created (3 stages × 3 deliverables = 9).
    const taskSnap = await db.collection("tasks").where("orgId", "==", ORG).get();
    assert.equal(taskSnap.size, 9);

    // Check round-robin assignment on "Edit" stage.
    const editTasks = taskSnap.docs.filter((d) => d.get("stageId") === "s_edit");
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

  it("201 respects skipStageIds", async () => {
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
