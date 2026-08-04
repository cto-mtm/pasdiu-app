// POST /orgs/:orgId/invites/:inviteId/decline — the invitee refusing.
//
// Joining a workspace is the invitee's own act, so refusing has to be one too.
// The security property that matters here: the invite must be addressed to the
// CALLER's email, or one user could decline invitations meant for someone else.
//
// Each test owns its uid + email pair — clearFirestore() resets Firestore but
// not the Auth emulator, so a shared address collides across tests.
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import {
  clearFirestore,
  makeUserToken,
  post,
  postAnon,
  seedInvite,
  seedMember,
  seedOrg,
} from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
});

async function seedInvitingOrg(orgId: string, inviteId: string, email: string, over = {}) {
  await seedOrg(orgId, { name: `Studio ${orgId}` });
  await seedMember(orgId, "u-inviter", "admin", { displayName: "Paula Ramos" });
  await seedInvite(orgId, inviteId, { email, invitedBy: "u-inviter", ...over });
}

const path = (orgId: string, inviteId: string) =>
  `/orgs/${orgId}/invites/${inviteId}/decline`;

describe("POST /orgs/:orgId/invites/:inviteId/decline", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await postAnon(path("org-d", "inv-d"));
    expect(res.status).toBe(401);
  });

  it("rejects an unverified email (403)", async () => {
    await seedInvitingOrg("org-d1", "inv-d1", "d-unverified@test.dev");
    const token = await makeUserToken({
      uid: "u-d-unverified",
      email: "d-unverified@test.dev",
      emailVerified: false,
    });
    const res = await post(path("org-d1", "inv-d1"), token);
    expect(res.status).toBe(403);
  });

  it("404s an invite addressed to somebody else, leaving it pending", async () => {
    await seedInvitingOrg("org-d2", "inv-d2", "the-invitee@test.dev");
    const token = await makeUserToken({ uid: "u-d-other", email: "d-other@test.dev" });

    const res = await post(path("org-d2", "inv-d2"), token);

    expect(res.status).toBe(404);
    // The real assertion: someone else's invitation is untouched.
    const snap = await getFirestore().doc("orgs/org-d2/invites/inv-d2").get();
    expect(snap.get("status")).toBe("pending");
  });

  it("404s an invite that does not exist", async () => {
    const token = await makeUserToken({ uid: "u-d-missing", email: "d-missing@test.dev" });
    const res = await post(path("org-nope", "inv-nope"), token);
    expect(res.status).toBe(404);
  });

  it("declines the caller's own invite and records when", async () => {
    await seedInvitingOrg("org-d3", "inv-d3", "d-happy@test.dev");
    const token = await makeUserToken({ uid: "u-d-happy", email: "d-happy@test.dev" });

    const res = await post(path("org-d3", "inv-d3"), token);

    expect(res.status).toBe(200);
    expect(res.body.declined).toBe(true);

    const snap = await getFirestore().doc("orgs/org-d3/invites/inv-d3").get();
    expect(snap.get("status")).toBe("declined");
    expect(snap.get("declinedAt")).toBeTruthy();
    // Declining must not make the user a member of anything.
    const member = await getFirestore().doc("orgs/org-d3/members/u-d-happy").get();
    expect(member.exists).toBe(false);
  });

  it("does not consume a seat", async () => {
    await seedInvitingOrg("org-d4", "inv-d4", "d-seat@test.dev");
    await getFirestore().doc("orgs/org-d4/usage/current").set({ seats: 1 });
    const token = await makeUserToken({ uid: "u-d-seat", email: "d-seat@test.dev" });

    await post(path("org-d4", "inv-d4"), token);

    const usage = await getFirestore().doc("orgs/org-d4/usage/current").get();
    expect(usage.get("seats")).toBe(1);
  });

  it("is terminal — a declined invite can no longer be accepted", async () => {
    await seedInvitingOrg("org-d5", "inv-d5", "d-term@test.dev");
    const token = await makeUserToken({ uid: "u-d-term", email: "d-term@test.dev" });

    expect((await post(path("org-d5", "inv-d5"), token)).status).toBe(200);

    const accept = await post(`/orgs/org-d5/invites/inv-d5/accept`, token);
    expect(accept.status).toBe(404);
    const member = await getFirestore().doc("orgs/org-d5/members/u-d-term").get();
    expect(member.exists).toBe(false);
  });

  it("404s a second decline of the same invite", async () => {
    await seedInvitingOrg("org-d6", "inv-d6", "d-twice@test.dev");
    const token = await makeUserToken({ uid: "u-d-twice", email: "d-twice@test.dev" });

    expect((await post(path("org-d6", "inv-d6"), token)).status).toBe(200);
    expect((await post(path("org-d6", "inv-d6"), token)).status).toBe(404);
  });

  it("accepts a decline of an already-expired invite", async () => {
    // Expiry blocks joining, not answering. Refusing a lapsed invitation is
    // harmless and still records the answer for the manager.
    await seedInvitingOrg("org-d7", "inv-d7", "d-exp@test.dev", {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const token = await makeUserToken({ uid: "u-d-exp", email: "d-exp@test.dev" });

    const res = await post(path("org-d7", "inv-d7"), token);

    expect(res.status).toBe(200);
    const snap = await getFirestore().doc("orgs/org-d7/invites/inv-d7").get();
    expect(snap.get("status")).toBe("declined");
  });
});
