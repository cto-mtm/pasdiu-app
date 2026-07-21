// POST /orgs/:orgId/reconcile — the dev/support trigger for the nightly
// reconcileUsage schedule — plus reconcileOrg() called directly (schedules
// never fire in the emulator, so the job's logic is tested as a plain
// function; the onSchedule wrapper in src/index.ts stays thin).
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { reconcileOrg } from "../src/helpers/reconcile.js";
import {
  clearFirestore,
  makeUserToken,
  post,
  postAnon,
  seedOrg,
  seedMember,
  seedUsage,
  seedClient,
  seedTask,
} from "./helpers.js";

const ORG = "org-a";
const OWNER = "u-owner-a";

beforeEach(async () => {
  await clearFirestore();
  await seedOrg(ORG, { ownerUid: OWNER });
  await seedMember(ORG, OWNER, "admin");
  await seedUsage(ORG, { seats: 1 });
});

describe("POST /orgs/:orgId/reconcile", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await postAnon(`/orgs/${ORG}/reconcile`);
    expect(res.status).toBe(401);
  });

  it("403s for a non-manager member", async () => {
    await seedMember(ORG, "u-rec-contractor", "contractor");
    const token = await makeUserToken({ uid: "u-rec-contractor", email: "rec-contractor@test.dev" });
    const res = await post(`/orgs/${ORG}/reconcile`, token);
    expect(res.status).toBe(403);
  });

  it("403s for a non-member", async () => {
    const token = await makeUserToken({ uid: "u-rec-stranger", email: "rec-stranger@test.dev" });
    const res = await post(`/orgs/${ORG}/reconcile`, token);
    expect(res.status).toBe(403);
  });

  it("404s for an unknown org", async () => {
    // The manager gate reads the member doc first, so reach the org check via
    // an orphan membership (subcollection docs can exist without a parent).
    await seedMember("org-ghost", "u-rec-ghost-mgr", "admin");
    const token = await makeUserToken({ uid: "u-rec-ghost-mgr", email: "rec-ghost@test.dev" });
    const res = await post("/orgs/org-ghost/reconcile", token);
    expect(res.status).toBe(404);
  });

  it("heals drifted usage counters (200, healed: true)", async () => {
    // Reality: 3 members, 2 clients, 3 tasks…
    await seedMember(ORG, "u-rec-m1", "contractor");
    await seedMember(ORG, "u-rec-m2", "pm");
    await seedClient(ORG, "client-rec-1");
    await seedClient(ORG, "client-rec-2");
    await seedTask(ORG, "task-rec-1");
    await seedTask(ORG, "task-rec-2");
    await seedTask(ORG, "task-rec-3");
    // …plus another org's data that must NOT leak into the recount.
    await seedOrg("org-b");
    await seedClient("org-b", "client-rec-b");
    await seedTask("org-b", "task-rec-b");
    // Counters seeded WRONG on purpose.
    await seedUsage(ORG, { seats: 9, activeClients: 0, activeTasks: 99 });

    const token = await makeUserToken({ uid: OWNER, email: "owner-a@test.dev" });
    const res = await post(`/orgs/${ORG}/reconcile`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orgId: ORG,
      healed: true,
      before: { seats: 9, activeClients: 0, activeTasks: 99 },
      after: { seats: 3, activeClients: 2, activeTasks: 3 },
    });

    const usage = await getFirestore().doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.data()).toEqual({ seats: 3, activeClients: 2, activeTasks: 3 });
  });

  it("reports healed: false when the counters are already correct", async () => {
    const token = await makeUserToken({ uid: OWNER, email: "owner-a@test.dev" });
    const res = await post(`/orgs/${ORG}/reconcile`, token);
    expect(res.status).toBe(200);
    expect(res.body.healed).toBe(false);
    expect(res.body.before).toEqual(res.body.after);
    expect(res.body.after).toEqual({ seats: 1, activeClients: 0, activeTasks: 0 });
  });
});

describe("reconcileOrg (direct call — the scheduled job's core)", () => {
  it("recounts and corrects a drifted org", async () => {
    await seedOrg("org-direct");
    await seedMember("org-direct", "u-rec-d1", "admin");
    await seedMember("org-direct", "u-rec-d2", "contractor");
    await seedClient("org-direct", "client-rec-d1");
    await seedUsage("org-direct", { seats: 1, activeClients: 5, activeTasks: 2 });

    const result = await reconcileOrg("org-direct");
    expect(result).toEqual({
      orgId: "org-direct",
      healed: true,
      before: { seats: 1, activeClients: 5, activeTasks: 2 },
      after: { seats: 2, activeClients: 1, activeTasks: 0 },
    });

    const usage = await getFirestore().doc("orgs/org-direct/usage/current").get();
    expect(usage.data()).toEqual({ seats: 2, activeClients: 1, activeTasks: 0 });
  });
});
