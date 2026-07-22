// GET /orgs/:orgId/invites/:inviteId (authed), the public .../preview,
// POST .../accept, and POST .../resend.
// The invite is addressed to an email; the caller's token email must match.
import { describe, it, expect, beforeEach } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import {
  clearFirestore,
  makeUserToken,
  get,
  post,
  getAnon,
  postAnon,
  seedOrg,
  seedUsage,
  seedInvite,
  seedMember,
} from "./helpers.js";

const ORG = "org-a";

const IN_AN_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);
const AN_HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);

beforeEach(async () => {
  await clearFirestore();
  await seedOrg(ORG);
  await seedUsage(ORG, { seats: 1 }); // the owner's seat
});

describe("GET /orgs/:orgId/invites/:inviteId/preview (public)", () => {
  it("returns org name, role, and a MASKED email with no auth", async () => {
    await seedInvite(ORG, "inv-prev", { email: "invitee@test.dev", role: "client" });
    const res = await getAnon(`/orgs/${ORG}/invites/inv-prev/preview`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orgName: `Org ${ORG}`,
      role: "client",
      emailHint: "i•••@test.dev",
    });
    // The full address must never leak through the public endpoint.
    expect(JSON.stringify(res.body)).not.toContain("invitee@test.dev");
  });

  it("404s for a nonexistent invite", async () => {
    const res = await getAnon(`/orgs/${ORG}/invites/inv-nope/preview`);
    expect(res.status).toBe(404);
  });

  it("404s for a revoked invite", async () => {
    await seedInvite(ORG, "inv-prev-rev", { status: "revoked" });
    const res = await getAnon(`/orgs/${ORG}/invites/inv-prev-rev/preview`);
    expect(res.status).toBe(404);
  });

  it("404s for an accepted invite", async () => {
    await seedInvite(ORG, "inv-prev-acc", { status: "accepted" });
    const res = await getAnon(`/orgs/${ORG}/invites/inv-prev-acc/preview`);
    expect(res.status).toBe(404);
  });

  it("404s for an expired invite", async () => {
    await seedInvite(ORG, "inv-prev-exp", { expiresAt: AN_HOUR_AGO() });
    const res = await getAnon(`/orgs/${ORG}/invites/inv-prev-exp/preview`);
    expect(res.status).toBe(404);
  });

  it("200s for an unexpired invite with a future expiresAt", async () => {
    await seedInvite(ORG, "inv-prev-fresh", { expiresAt: IN_AN_HOUR() });
    const res = await getAnon(`/orgs/${ORG}/invites/inv-prev-fresh/preview`);
    expect(res.status).toBe(200);
  });
});

describe("GET /orgs/:orgId/invites/:inviteId (preview)", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await getAnon(`/orgs/${ORG}/invites/inv-x`);
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent invite", async () => {
    const token = await makeUserToken({ uid: "u-inv-none", email: "inv-none@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-missing`, token);
    expect(res.status).toBe(404);
  });

  it("404s for a revoked invite", async () => {
    await seedInvite(ORG, "inv-revoked", { email: "inv-revoked@test.dev", status: "revoked" });
    const token = await makeUserToken({ uid: "u-inv-revoked", email: "inv-revoked@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-revoked`, token);
    expect(res.status).toBe(404);
  });

  it("404s for an already-accepted invite", async () => {
    await seedInvite(ORG, "inv-done", { email: "inv-done@test.dev", status: "accepted" });
    const token = await makeUserToken({ uid: "u-inv-done", email: "inv-done@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-done`, token);
    expect(res.status).toBe(404);
  });

  it("404s when the caller's email is not the invite's email", async () => {
    await seedInvite(ORG, "inv-other", { email: "someone-else@test.dev" });
    const token = await makeUserToken({ uid: "u-inv-wrong", email: "inv-wrong@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-other`, token);
    expect(res.status).toBe(404);
  });

  it("returns { orgName, role, email } for the addressed caller (200)", async () => {
    await seedInvite(ORG, "inv-ok", { email: "inv-ok@test.dev", role: "pm" });
    const token = await makeUserToken({ uid: "u-inv-ok", email: "inv-ok@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-ok`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgName: `Org ${ORG}`, role: "pm", email: "inv-ok@test.dev" });
  });

  it("404s for an expired invite even for the addressed caller", async () => {
    await seedInvite(ORG, "inv-old", { email: "inv-old@test.dev", expiresAt: AN_HOUR_AGO() });
    const token = await makeUserToken({ uid: "u-inv-old", email: "inv-old@test.dev" });
    const res = await get(`/orgs/${ORG}/invites/inv-old`, token);
    expect(res.status).toBe(404);
  });
});

describe("POST /orgs/:orgId/invites/:inviteId/accept", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await postAnon(`/orgs/${ORG}/invites/inv-x/accept`);
    expect(res.status).toBe(401);
  });

  it("creates the membership from the invite, bumps seats, marks accepted", async () => {
    await seedInvite(ORG, "inv-accept", {
      email: "inv-accept@test.dev",
      role: "client",
      clientId: "c-1",
      invitedBy: "u-inviter",
    });
    const token = await makeUserToken({
      uid: "u-inv-accept",
      email: "inv-accept@test.dev",
      displayName: "Ivy Invitee",
    });
    const res = await post(`/orgs/${ORG}/invites/inv-accept/accept`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgId: ORG });

    const db = getFirestore();
    const member = await db.doc(`orgs/${ORG}/members/u-inv-accept`).get();
    expect(member.data()).toMatchObject({
      uid: "u-inv-accept",
      orgId: ORG,
      orgName: `Org ${ORG}`,
      displayName: "Ivy Invitee",
      email: "inv-accept@test.dev",
      role: "client",
      clientId: "c-1",
      invitedBy: "u-inviter",
    });
    expect(member.get("joinedAt")).toBeTruthy();

    const usage = await db.doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(2); // 1 (owner) + the new member

    const invite = await db.doc(`orgs/${ORG}/invites/inv-accept`).get();
    expect(invite.get("status")).toBe("accepted");
  });

  it("is idempotent: a second accept is 200 with no double seat increment", async () => {
    await seedInvite(ORG, "inv-twice", { email: "inv-twice@test.dev", role: "contractor" });
    const token = await makeUserToken({ uid: "u-inv-twice", email: "inv-twice@test.dev" });

    const first = await post(`/orgs/${ORG}/invites/inv-twice/accept`, token);
    expect(first.status).toBe(200);
    const second = await post(`/orgs/${ORG}/invites/inv-twice/accept`, token);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ orgId: ORG });

    const usage = await getFirestore().doc(`orgs/${ORG}/usage/current`).get();
    expect(usage.get("seats")).toBe(2); // not 3
  });

  it("409s with seat_limit when usage.seats == org.seatLimit", async () => {
    // Free plan seatLimit is 2 (seedOrg default) — put the org AT the limit.
    await seedUsage(ORG, { seats: 2 });
    await seedInvite(ORG, "inv-full", { email: "inv-full@test.dev" });
    const token = await makeUserToken({ uid: "u-inv-full", email: "inv-full@test.dev" });

    const res = await post(`/orgs/${ORG}/invites/inv-full/accept`, token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("seat_limit");

    const db = getFirestore();
    const member = await db.doc(`orgs/${ORG}/members/u-inv-full`).get();
    expect(member.exists).toBe(false);
    const invite = await db.doc(`orgs/${ORG}/invites/inv-full`).get();
    expect(invite.get("status")).toBe("pending"); // untouched
  });

  it("404s when accepting a revoked invite", async () => {
    await seedInvite(ORG, "inv-gone", { email: "inv-gone@test.dev", status: "revoked" });
    const token = await makeUserToken({ uid: "u-inv-gone", email: "inv-gone@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-gone/accept`, token);
    expect(res.status).toBe(404);
    const member = await getFirestore().doc(`orgs/${ORG}/members/u-inv-gone`).get();
    expect(member.exists).toBe(false);
  });

  it("404s when accepting an expired invite (member not created)", async () => {
    await seedInvite(ORG, "inv-exp", { email: "inv-exp@test.dev", expiresAt: AN_HOUR_AGO() });
    const token = await makeUserToken({ uid: "u-inv-exp", email: "inv-exp@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-exp/accept`, token);
    expect(res.status).toBe(404);
    const member = await getFirestore().doc(`orgs/${ORG}/members/u-inv-exp`).get();
    expect(member.exists).toBe(false);
  });

  it("accepts an unexpired invite with a future expiresAt", async () => {
    // Legacy invites WITHOUT expiresAt are covered by every other accept test
    // (seedInvite's default shape has no expiry) — this is the future-dated leg.
    await seedInvite(ORG, "inv-fresh", { email: "inv-fresh@test.dev", expiresAt: IN_AN_HOUR() });
    const token = await makeUserToken({ uid: "u-inv-fresh", email: "inv-fresh@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-fresh/accept`, token);
    expect(res.status).toBe(200);
  });

  it("stores invitedBy: null when the invite doc lacks invitedBy (regression)", async () => {
    // A fixed bug: Firestore rejects `undefined`, so an invite written without
    // invitedBy must not 500 the whole accept.
    await seedInvite(ORG, "inv-noby", { email: "inv-noby@test.dev", invitedBy: undefined });
    const token = await makeUserToken({ uid: "u-inv-noby", email: "inv-noby@test.dev" });

    const res = await post(`/orgs/${ORG}/invites/inv-noby/accept`, token);
    expect(res.status).toBe(200);

    const member = await getFirestore().doc(`orgs/${ORG}/members/u-inv-noby`).get();
    expect(member.exists).toBe(true);
    expect(member.get("invitedBy")).toBeNull();
    expect(member.get("clientId")).toBeUndefined(); // no clientId on the invite
  });
});

describe("POST /orgs/:orgId/invites/:inviteId/resend", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await postAnon(`/orgs/${ORG}/invites/inv-x/resend`);
    expect(res.status).toBe(401);
  });

  it("403s for a non-manager member", async () => {
    await seedMember(ORG, "u-editor", "contractor");
    await seedInvite(ORG, "inv-rs-403");
    const token = await makeUserToken({ uid: "u-editor", email: "u-editor@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-rs-403/resend`, token);
    expect(res.status).toBe(403);
  });

  it("404s for a revoked invite", async () => {
    await seedMember(ORG, "u-mgr", "admin");
    await seedInvite(ORG, "inv-rs-rev", { status: "revoked" });
    const token = await makeUserToken({ uid: "u-mgr", email: "u-mgr@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-rs-rev/resend`, token);
    expect(res.status).toBe(404);
  });

  it("404s for an expired invite", async () => {
    await seedMember(ORG, "u-mgr2", "admin");
    await seedInvite(ORG, "inv-rs-exp", { expiresAt: new Date(Date.now() - 1000) });
    const token = await makeUserToken({ uid: "u-mgr2", email: "u-mgr2@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-rs-exp/resend`, token);
    expect(res.status).toBe(404);
  });

  it("re-queues the mail doc for a manager (200)", async () => {
    await seedMember(ORG, "u-mgr3", "pm"); // pm counts as manager
    await seedInvite(ORG, "inv-rs-ok", { email: "rs-ok@test.dev" });
    const token = await makeUserToken({ uid: "u-mgr3", email: "u-mgr3@test.dev" });
    const res = await post(`/orgs/${ORG}/invites/inv-rs-ok/resend`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true });

    const mail = await getFirestore().doc(`mail/invite-${ORG}-inv-rs-ok`).get();
    expect(mail.exists).toBe(true);
    expect(mail.get("to")).toEqual(["rs-ok@test.dev"]);
  });
});
