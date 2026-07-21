// DELETE /orgs/:orgId/members/:uid — manager removal or self-leave, with the
// owner protected and the seat counter kept in step transactionally.
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import {
  clearFirestore,
  makeUserToken,
  del,
  delAnon,
  seedOrg,
  seedMember,
  seedUsage,
} from "./helpers.js";

const ORG = "org-a";
const OWNER = "u-owner-a";

beforeEach(async () => {
  await clearFirestore();
  await seedOrg(ORG, { ownerUid: OWNER });
  await seedMember(ORG, OWNER, "admin");
  await seedUsage(ORG, { seats: 1 });
});

describe("DELETE /orgs/:orgId/members/:uid", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await delAnon(`/orgs/${ORG}/members/${OWNER}`);
    expect(res.status).toBe(401);
  });

  it("403s when the caller is not a member of the org", async () => {
    await seedMember(ORG, "u-mem-target1", "contractor");
    await seedUsage(ORG, { seats: 2 });
    const token = await makeUserToken({ uid: "u-mem-stranger", email: "mem-stranger@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-target1`, token);
    expect(res.status).toBe(403);
    const member = await getFirestore().doc(`orgs/${ORG}/members/u-mem-target1`).get();
    expect(member.exists).toBe(true); // untouched
  });

  it("403s cross-org: a manager of org B cannot remove from org A", async () => {
    await seedOrg("org-b", { ownerUid: "u-owner-b" });
    await seedMember("org-b", "u-mem-mgr-b", "pm");
    await seedMember(ORG, "u-mem-target2", "contractor");
    await seedUsage(ORG, { seats: 2 });
    const token = await makeUserToken({ uid: "u-mem-mgr-b", email: "mem-mgr-b@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-target2`, token);
    expect(res.status).toBe(403);
    const member = await getFirestore().doc(`orgs/${ORG}/members/u-mem-target2`).get();
    expect(member.exists).toBe(true);
  });

  it("403s for a non-manager role removing someone else", async () => {
    await seedMember(ORG, "u-mem-contractor", "contractor");
    await seedMember(ORG, "u-mem-target3", "contractor");
    await seedUsage(ORG, { seats: 3 });
    const token = await makeUserToken({ uid: "u-mem-contractor", email: "mem-contractor@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-target3`, token);
    expect(res.status).toBe(403);
  });

  it("lets a manager remove a member (204) and decrements seats", async () => {
    await seedMember(ORG, "u-mem-target4", "contractor");
    await seedUsage(ORG, { seats: 2 });
    const token = await makeUserToken({ uid: OWNER, email: "owner-a@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-target4`, token);
    expect(res.status).toBe(204);

    const db = getFirestore();
    const member = await db.doc(`orgs/${ORG}/members/u-mem-target4`).get();
    expect(member.exists).toBe(false);
    const usage = await db.doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(1);
  });

  it("lets a non-manager leave on their own (204) and decrements seats", async () => {
    await seedMember(ORG, "u-mem-leaver", "contractor");
    await seedUsage(ORG, { seats: 2 });
    const token = await makeUserToken({ uid: "u-mem-leaver", email: "mem-leaver@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-leaver`, token);
    expect(res.status).toBe(204);

    const db = getFirestore();
    const member = await db.doc(`orgs/${ORG}/members/u-mem-leaver`).get();
    expect(member.exists).toBe(false);
    const usage = await db.doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(1);
  });

  it("409s when removing the org owner; the membership stays intact", async () => {
    await seedMember(ORG, "u-mem-pm", "pm");
    await seedUsage(ORG, { seats: 2 });
    const token = await makeUserToken({ uid: "u-mem-pm", email: "mem-pm@test.dev" });

    const res = await del(`/orgs/${ORG}/members/${OWNER}`, token);
    expect(res.status).toBe(409);

    const db = getFirestore();
    const owner = await db.doc(`orgs/${ORG}/members/${OWNER}`).get();
    expect(owner.exists).toBe(true);
    const usage = await db.doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(2); // unchanged
  });

  it("404s when removing a non-existent member; seats unchanged", async () => {
    // Per the code: org exists → not the owner → caller is a manager → the
    // member snapshot is missing → 404 "Member not found" (transaction aborts,
    // so the seat counter is never decremented).
    const token = await makeUserToken({ uid: OWNER, email: "owner-a@test.dev" });

    const res = await del(`/orgs/${ORG}/members/u-mem-ghost`, token);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Member not found");

    const usage = await getFirestore().doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(1);
  });
});
