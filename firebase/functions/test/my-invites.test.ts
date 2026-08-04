// GET /orgs/my-invites — the invitations addressed to the caller's own email.
// This is what lets the welcome screen show "X at Y invited you" instead of
// telling a user with a perfectly good invitation to go find an email.
//
// Every test uses its OWN uid + email pair: clearFirestore() resets Firestore
// between tests but not the Auth emulator, so reusing an address across tests
// collides with the account the previous one created.
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearFirestore,
  get,
  getAnon,
  makeUserToken,
  seedInvite,
  seedMember,
  seedOrg,
} from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
});

/** An org whose admin ("Paula Ramos") has invited `email`. */
async function seedInvitingOrg(orgId: string, inviteId: string, email: string, over = {}) {
  await seedOrg(orgId, { name: `Studio ${orgId}` });
  await seedMember(orgId, "u-inviter", "admin", { displayName: "Paula Ramos" });
  await seedInvite(orgId, inviteId, { email, invitedBy: "u-inviter", ...over });
}

describe("GET /orgs/my-invites", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await getAnon("/orgs/my-invites");
    expect(res.status).toBe(401);
  });

  it("rejects an unverified email (403)", async () => {
    const token = await makeUserToken({
      uid: "u-mi-unverified",
      email: "mi-unverified@test.dev",
      emailVerified: false,
    });
    const res = await get("/orgs/my-invites", token);
    expect(res.status).toBe(403);
  });

  it("returns the invite with the workspace and the inviter's name", async () => {
    await seedInvitingOrg("org-mi", "inv-1", "mi-happy@test.dev");
    const token = await makeUserToken({ uid: "u-mi-happy", email: "mi-happy@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(1);
    expect(res.body.invites[0]).toMatchObject({
      orgId: "org-mi",
      inviteId: "inv-1",
      orgName: "Studio org-mi",
      role: "contractor",
      // The attribution the welcome screen renders.
      invitedByName: "Paula Ramos",
    });
  });

  it("returns an empty inviter name when the inviter has left the org", async () => {
    await seedOrg("org-gone", { name: "Ghost Studio" });
    await seedInvite("org-gone", "inv-gone", {
      email: "mi-gone@test.dev",
      invitedBy: "u-departed",
    });
    const token = await makeUserToken({ uid: "u-mi-gone", email: "mi-gone@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    // Still listed — a missing inviter must not hide a valid invitation; the
    // UI falls back to naming the workspace alone.
    expect(res.body.invites).toHaveLength(1);
    expect(res.body.invites[0].invitedByName).toBe("");
    expect(res.body.invites[0].orgName).toBe("Ghost Studio");
  });

  it("never returns invites addressed to a different email", async () => {
    await seedInvitingOrg("org-other", "inv-other", "someone-else@test.dev");
    const token = await makeUserToken({ uid: "u-mi-other", email: "mi-other@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
  });

  it("excludes accepted, revoked and declined invites", async () => {
    await seedInvitingOrg("org-acc", "inv-accepted", "mi-done@test.dev", { status: "accepted" });
    await seedInvitingOrg("org-rev", "inv-revoked", "mi-done@test.dev", { status: "revoked" });
    // A refused invitation must not come back to haunt the person who refused.
    await seedInvitingOrg("org-dec", "inv-declined", "mi-done@test.dev", { status: "declined" });
    const token = await makeUserToken({ uid: "u-mi-done", email: "mi-done@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
  });

  it("excludes expired invites", async () => {
    await seedInvitingOrg("org-exp", "inv-expired", "mi-exp@test.dev", {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const token = await makeUserToken({ uid: "u-mi-exp", email: "mi-exp@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
  });

  it("lists invites from every workspace that invited this address", async () => {
    await seedInvitingOrg("org-a", "inv-a", "mi-multi@test.dev");
    await seedInvitingOrg("org-b", "inv-b", "mi-multi@test.dev");
    const token = await makeUserToken({ uid: "u-mi-multi", email: "mi-multi@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(2);
    expect(res.body.invites.map((i: { orgId: string }) => i.orgId).sort()).toEqual(["org-a", "org-b"]);
  });

  // An invite stays 'pending' until someone acts on it, so joining by another
  // route leaves the original behind. The app shell renders this list beside
  // the workspace switcher, where such a row reads as an offer to join the
  // workspace the user is already looking at.
  it("omits invites to a workspace the caller already belongs to", async () => {
    await seedInvitingOrg("org-mi-member", "inv-member", "mi-member@test.dev");
    await seedMember("org-mi-member", "u-mi-member", "contractor");
    const token = await makeUserToken({ uid: "u-mi-member", email: "mi-member@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
  });

  it("keeps invites from OTHER workspaces when the caller belongs to one", async () => {
    await seedInvitingOrg("org-mi-in", "inv-in", "mi-mixed@test.dev");
    await seedMember("org-mi-in", "u-mi-mixed", "contractor");
    await seedInvitingOrg("org-mi-out", "inv-out", "mi-mixed@test.dev");
    const token = await makeUserToken({ uid: "u-mi-mixed", email: "mi-mixed@test.dev" });

    const res = await get("/orgs/my-invites", token);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(1);
    expect(res.body.invites[0].orgId).toBe("org-mi-out");
  });
});
