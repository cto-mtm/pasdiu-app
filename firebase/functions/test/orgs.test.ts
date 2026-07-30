// POST /orgs — self-serve workspace creation (the reference implementation of
// the coverage matrix: 401 / 403 / 400 / happy path + side-effect asserts).
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { PLAN_LIMITS } from "../src/plans.js";
import { clearFirestore, makeUserToken, post, postAnon } from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
});

describe("POST /orgs", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await postAnon("/orgs", { name: "No Auth Studio" });
    expect(res.status).toBe(401);
  });

  it("rejects an unverified email (403)", async () => {
    const token = await makeUserToken({
      uid: "u-orgs-unverified",
      email: "orgs-unverified@test.dev",
      emailVerified: false,
    });
    const res = await post("/orgs", token, { name: "Unverified Studio" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Email not verified");
  });

  it("rejects an empty name (400)", async () => {
    const token = await makeUserToken({ uid: "u-orgs-empty", email: "orgs-empty@test.dev" });
    const res = await post("/orgs", token, { name: "   " }); // trims to empty
    expect(res.status).toBe(400);
  });

  it("rejects a 61-character name (400)", async () => {
    const token = await makeUserToken({ uid: "u-orgs-long", email: "orgs-long@test.dev" });
    const res = await post("/orgs", token, { name: "a".repeat(61) });
    expect(res.status).toBe(400);
  });

  it("creates org + admin membership + identity doc + usage counters (201)", async () => {
    const token = await makeUserToken({
      uid: "u-orgs-owner",
      email: "orgs-owner@test.dev",
      displayName: "Olive Owner",
    });
    const res = await post("/orgs", token, { name: "  Test Studio  " });
    expect(res.status).toBe(201);
    const orgId = res.body.orgId as string;
    expect(orgId).toBeTruthy();

    const db = getFirestore();

    // Org doc: trimmed name + the full free-plan billing block from PLAN_LIMITS.
    const org = await db.doc(`orgs/${orgId}`).get();
    expect(org.exists).toBe(true);
    expect(org.get("name")).toBe("Test Studio");
    expect(org.get("ownerUid")).toBe("u-orgs-owner");
    expect(org.get("plan")).toBe("free");
    expect(org.get("seatLimit")).toBe(PLAN_LIMITS.free.seatLimit);
    expect(org.get("clientLimit")).toBe(PLAN_LIMITS.free.clientLimit);
    expect(org.get("taskLimit")).toBe(PLAN_LIMITS.free.taskLimit);
    expect(org.get("subscriptionStatus")).toBe("none");
    expect(org.get("createdAt")).toBeTruthy();

    // Owner membership, denormalized for collection-group queries.
    const member = await db.doc(`orgs/${orgId}/members/u-orgs-owner`).get();
    expect(member.data()).toMatchObject({
      uid: "u-orgs-owner",
      orgId,
      orgName: "Test Studio",
      displayName: "Olive Owner",
      email: "orgs-owner@test.dev",
      role: "admin",
    });
    expect(member.get("joinedAt")).toBeTruthy();

    // users/{uid} identity upsert (merge).
    const userDoc = await db.doc("users/u-orgs-owner").get();
    expect(userDoc.data()).toMatchObject({
      displayName: "Olive Owner",
      email: "orgs-owner@test.dev",
    });

    // Usage counters: the owner's seat, nothing else.
    const usage = await db.doc(`orgs/${orgId}/usage/current`).get();
    expect(usage.data()).toEqual({ seats: 1, activeClients: 0, activeTasks: 0, activeDeliverables: 0 });
  });
});
