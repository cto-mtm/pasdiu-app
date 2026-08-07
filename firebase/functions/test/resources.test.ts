// Integration tests for the cascade-delete endpoints:
//   DELETE /orgs/:orgId/subgroups/:subGroupId
//   DELETE /orgs/:orgId/projects/:projectId
//   DELETE /orgs/:orgId/clients/:clientId
// Coverage matrix per docs/testing.md (401 / 403 unverified / 403 wrong org /
// 403 role / 404 / happy path) plus the property that matters most here: the
// subtree is removed with NO orphans (deliverables, stage tasks, and their
// versions/notes all gone) and the usage counters move by the right deltas.
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import {
  del, delAnon, clearFirestore, makeUserToken,
  seedOrg, seedMember, seedUsage, seedClient,
  seedDeliverable, seedDeliverableVersion, seedTask,
} from "./helpers.js";

const ORG = "org-cas";

interface Tokens {
  mgr: string; contractor: string; client: string; unverified: string; outsider: string;
}
let T: Tokens;

// A full hierarchy: client → project → sub-group → one active deliverable with
// two stage tasks (+ a version and a note), plus one standalone task filed
// directly under the sub-group. Counters seeded above the real counts so the
// deltas are unambiguous.
async function seedTree(): Promise<void> {
  const db = getFirestore();
  await seedOrg(ORG, { ownerUid: "u-mgr" });
  await seedMember(ORG, "u-mgr", "admin");
  await seedMember(ORG, "u-contractor", "contractor");
  await seedMember(ORG, "u-client", "client", { clientId: "c-1" });
  await seedUsage(ORG, { activeClients: 1, activeTasks: 3, activeDeliverables: 2 });

  await seedClient(ORG, "c-1");
  await db.doc("projects/p-1").set({
    orgId: ORG, clientId: "c-1", name: "P1",
    defaultView: "kanban", brief: { brandGuidelinesUrl: "", sopUrl: "", links: [], fields: [] }, meta: [],
  });
  await db.doc("subGroups/sg-1").set({ orgId: ORG, projectId: "p-1", name: "SG1", order: 0, meta: [] });

  await seedDeliverable(ORG, "d-1", { clientId: "c-1", projectId: "p-1", subGroupId: "sg-1", status: "active" });
  await seedDeliverableVersion("d-1", "v-1");
  await seedTask(ORG, "t-s1", { clientId: "c-1", projectId: "p-1", subGroupId: "sg-1", deliverableId: "d-1", stageId: "s_capture" });
  await seedTask(ORG, "t-s2", { clientId: "c-1", projectId: "p-1", subGroupId: "sg-1", deliverableId: "d-1", stageId: "s_edit" });
  await db.doc("tasks/t-s1/notes/n-1").set({ versionId: "", authorUid: "u-mgr", body: "x", resolved: false, createdAt: new Date() });
  await seedTask(ORG, "t-std", { clientId: "c-1", projectId: "p-1", subGroupId: "sg-1", deliverableId: "" });
}

async function makeTokens(): Promise<Tokens> {
  return {
    mgr: await makeUserToken({ uid: "u-mgr", email: "mgr@cas.test" }),
    contractor: await makeUserToken({ uid: "u-contractor", email: "con@cas.test" }),
    client: await makeUserToken({ uid: "u-client", email: "cl@cas.test" }),
    unverified: await makeUserToken({ uid: "u-unverified", email: "unv@cas.test", emailVerified: false }),
    outsider: await makeUserToken({ uid: "u-outsider", email: "out@cas.test" }),
  };
}

// The shared denial matrix — every cascade route rejects these identically.
function denialMatrix(path: string): void {
  it("401 unauthenticated", async () => {
    assert.equal((await delAnon(path)).status, 401);
  });
  it("403 unverified email", async () => {
    assert.equal((await del(path, T.unverified)).status, 403);
  });
  it("403 wrong org (not a member)", async () => {
    assert.equal((await del(path, T.outsider)).status, 403);
  });
  it("403 contractor role", async () => {
    assert.equal((await del(path, T.contractor)).status, 403);
  });
  it("403 client role", async () => {
    assert.equal((await del(path, T.client)).status, 403);
  });
}

async function usage(): Promise<{ clients: number; tasks: number; deliverables: number }> {
  const snap = await getFirestore().doc(`orgs/${ORG}/usage/current`).get();
  return {
    clients: snap.get("activeClients"),
    tasks: snap.get("activeTasks"),
    deliverables: snap.get("activeDeliverables"),
  };
}
async function exists(path: string): Promise<boolean> {
  return (await getFirestore().doc(path).get()).exists;
}

describe("DELETE /orgs/:orgId/subgroups/:subGroupId", () => {
  beforeEach(async () => { await clearFirestore(); await seedTree(); T = await makeTokens(); });

  denialMatrix(`/orgs/${ORG}/subgroups/sg-1`);

  it("404 for a missing sub-group", async () => {
    assert.equal((await del(`/orgs/${ORG}/subgroups/nope`, T.mgr)).status, 404);
  });

  it("200 removes the sub-group, its deliverable + stage tasks + standalone task, and subcollections", async () => {
    const res = await del(`/orgs/${ORG}/subgroups/sg-1`, T.mgr);
    assert.equal(res.status, 200);
    assert.equal(res.body.taskCount, 3);
    assert.equal(res.body.deliverableCount, 1);

    assert.equal(await exists("subGroups/sg-1"), false);
    assert.equal(await exists("deliverables/d-1"), false);
    assert.equal(await exists("deliverables/d-1/versions/v-1"), false);
    assert.equal(await exists("tasks/t-s1"), false);
    assert.equal(await exists("tasks/t-s1/notes/n-1"), false);
    assert.equal(await exists("tasks/t-s2"), false);
    assert.equal(await exists("tasks/t-std"), false);
    // The project and client are untouched.
    assert.equal(await exists("projects/p-1"), true);
    assert.equal(await exists("clients/c-1"), true);

    // Only the standalone task decrements activeTasks; the active deliverable
    // decrements activeDeliverables; activeClients is untouched.
    assert.deepEqual(await usage(), { clients: 1, tasks: 2, deliverables: 1 });
  });
});

describe("DELETE /orgs/:orgId/projects/:projectId", () => {
  beforeEach(async () => { await clearFirestore(); await seedTree(); T = await makeTokens(); });

  denialMatrix(`/orgs/${ORG}/projects/p-1`);

  it("404 for a missing project", async () => {
    assert.equal((await del(`/orgs/${ORG}/projects/nope`, T.mgr)).status, 404);
  });

  it("200 removes the project, its sub-groups, deliverables, and tasks", async () => {
    const res = await del(`/orgs/${ORG}/projects/p-1`, T.mgr);
    assert.equal(res.status, 200);
    assert.equal(res.body.taskCount, 3);
    assert.equal(res.body.deliverableCount, 1);
    assert.equal(res.body.subGroupCount, 1);

    assert.equal(await exists("projects/p-1"), false);
    assert.equal(await exists("subGroups/sg-1"), false);
    assert.equal(await exists("deliverables/d-1"), false);
    assert.equal(await exists("deliverables/d-1/versions/v-1"), false);
    assert.equal(await exists("tasks/t-s1"), false);
    assert.equal(await exists("tasks/t-std"), false);
    assert.equal(await exists("clients/c-1"), true);

    assert.deepEqual(await usage(), { clients: 1, tasks: 2, deliverables: 1 });
  });
});

describe("DELETE /orgs/:orgId/clients/:clientId", () => {
  beforeEach(async () => { await clearFirestore(); await seedTree(); T = await makeTokens(); });

  denialMatrix(`/orgs/${ORG}/clients/c-1`);

  it("404 for a missing client", async () => {
    assert.equal((await del(`/orgs/${ORG}/clients/nope`, T.mgr)).status, 404);
  });

  it("404 for another org's client (no cross-org delete by id)", async () => {
    await seedOrg("org-other", { ownerUid: "u-other" });
    await seedClient("org-other", "c-other");
    assert.equal((await del(`/orgs/${ORG}/clients/c-other`, T.mgr)).status, 404);
    assert.equal(await exists("clients/c-other"), true);
  });

  it("200 removes the client and its entire subtree with no orphans", async () => {
    const res = await del(`/orgs/${ORG}/clients/c-1`, T.mgr);
    assert.equal(res.status, 200);
    assert.equal(res.body.projectCount, 1);
    assert.equal(res.body.subGroupCount, 1);
    assert.equal(res.body.taskCount, 3);
    assert.equal(res.body.deliverableCount, 1);

    const db = getFirestore();
    assert.equal(await exists("clients/c-1"), false);
    assert.equal(await exists("projects/p-1"), false);
    assert.equal(await exists("subGroups/sg-1"), false);
    assert.equal(await exists("deliverables/d-1"), false);
    assert.equal(await exists("deliverables/d-1/versions/v-1"), false);
    assert.equal(await exists("tasks/t-s1/notes/n-1"), false);
    // Nothing stamped with this org survives in tasks or deliverables.
    assert.equal((await db.collection("tasks").where("orgId", "==", ORG).get()).size, 0);
    assert.equal((await db.collection("deliverables").where("orgId", "==", ORG).get()).size, 0);

    // All three counters move: -1 client, -1 standalone task, -1 active deliverable.
    assert.deepEqual(await usage(), { clients: 0, tasks: 2, deliverables: 1 });
  });
});
