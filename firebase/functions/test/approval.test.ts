// Integration tests for approval and request-changes endpoints.
// Coverage matrix (per docs/testing.md):
//   - 401 unauthenticated
//   - 403 wrong tenant (client approving another client's deliverable)
//   - 403 not visible (clientVisible === false)
//   - 403 contractor cannot approve
//   - 400 manager proxy without note
//   - 201 client approve (approvedVia = 'portal')
//   - 201 manager proxy approve (approvedVia = 'in_person')
//   - 201 request-changes sets revisions + note
//   - 201 bulk approve
// Runner note: these register with vitest (see package.json "test"). Importing
// describe/it from node:test instead makes the whole file silently register
// zero tests under `vitest run`.
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import {
  post, postAnon, clearFirestore, makeUserToken,
  seedOrg, seedMember, seedUsage, seedDeliverable,
} from "./helpers.js";

describe("Approval endpoints", () => {
  const ORG = "org-approval";
  let mgrToken: string;
  let clientToken: string;
  let client2Token: string;
  let contractorToken: string;

  beforeEach(async () => {
    await clearFirestore();
    await seedOrg(ORG, { ownerUid: "u-mgr", deliverableLimit: -1, pipeline: { stages: [] } });
    await seedMember(ORG, "u-mgr", "admin");
    await seedMember(ORG, "u-contractor", "contractor");
    await seedMember(ORG, "u-client", "client", { clientId: "c1" });
    await seedMember(ORG, "u-client2", "client", { clientId: "c2" });
    await seedUsage(ORG);

    // Deliverable visible to c1.
    await seedDeliverable(ORG, "del-vis", { clientId: "c1", clientVisible: true, status: "active" });
    // Deliverable NOT visible.
    await seedDeliverable(ORG, "del-hid", { clientId: "c1", clientVisible: false, status: "active" });
    // Deliverable of a DIFFERENT client.
    await seedDeliverable(ORG, "del-other", { clientId: "c2", clientVisible: true, status: "active" });

    // A task for the deliverable (so advanceApprovalTask has something to find).
    const db = getFirestore();
    await db.doc("tasks/t-vis").set({
      orgId: ORG, title: "Review", deliverableId: "del-vis", stageId: "s_review",
      status: "in_progress", assigneeUid: "u-contractor", clientId: "c1",
      projectId: "p1", subGroupId: "sg1", description: "", blockedReason: "",
      blockedAt: null, deliveryNote: "", meta: [], order: 0, dueAt: null,
      createdAt: new Date(), completedAt: null, clientVisible: true,
    });

    mgrToken = await makeUserToken({ uid: "u-mgr", email: "mgr@approval.test" });
    clientToken = await makeUserToken({ uid: "u-client", email: "cl@approval.test" });
    client2Token = await makeUserToken({ uid: "u-client2", email: "cl2@approval.test" });
    contractorToken = await makeUserToken({ uid: "u-contractor", email: "con@approval.test" });
  });

  describe("POST /orgs/:orgId/deliverables/:id/approve", () => {
    it("401 unauthenticated", async () => {
      const res = await postAnon(`/orgs/${ORG}/deliverables/del-vis/approve`);
      assert.equal(res.status, 401);
    });

    it("403 client approving another tenant's deliverable", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-other/approve`, clientToken);
      assert.equal(res.status, 403);
    });

    it("403 client approving non-visible deliverable", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-hid/approve`, clientToken);
      assert.equal(res.status, 403);
    });

    it("403 contractor cannot approve", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/approve`, contractorToken);
      assert.equal(res.status, 403);
    });

    it("400 manager proxy without note", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/approve`, mgrToken, {});
      assert.equal(res.status, 400);
      assert.match(res.body.error, /approval_note_required/);
    });

    it("201 client approve — approvedVia is portal", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/approve`, clientToken);
      assert.equal(res.status, 200);
      assert.equal(res.body.approvedVia, "portal");
      assert.equal(res.body.approvedBy, "u-client");

      // Verify Firestore state.
      const db = getFirestore();
      const snap = await db.doc("deliverables/del-vis").get();
      assert.equal(snap.get("approvedBy"), "u-client");
      assert.equal(snap.get("approvedVia"), "portal");
      assert.equal(snap.get("status"), "delivered");
      assert.ok(snap.get("approvedAt"));
    });

    it("201 manager proxy approve — approvedVia is in_person", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/approve`, mgrToken, {
        note: "Approved on set, July 25",
        via: "in_person",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.approvedVia, "in_person");

      const db = getFirestore();
      const snap = await db.doc("deliverables/del-vis").get();
      assert.equal(snap.get("approvedBy"), "u-mgr");
      assert.equal(snap.get("approvedVia"), "in_person");
      assert.equal(snap.get("approvalNote"), "Approved on set, July 25");
    });
  });

  describe("POST /orgs/:orgId/deliverables/:id/request-changes", () => {
    it("403 only clients can request changes", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/request-changes`, mgrToken, { note: "x" });
      assert.equal(res.status, 403);
    });

    it("201 sets revisions and attaches note", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/del-vis/request-changes`, clientToken, {
        note: "Logo should hold longer",
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.note);

      // Task moved to revisions.
      const db = getFirestore();
      const taskSnap = await db.doc("tasks/t-vis").get();
      assert.equal(taskSnap.get("status"), "revisions");

      // Note added to deliverable.
      const notesSnap = await db.collection("deliverables/del-vis/notes").get();
      assert.equal(notesSnap.size, 1);
      assert.equal(notesSnap.docs[0].get("body"), "Logo should hold longer");
    });
  });

  describe("POST /orgs/:orgId/deliverables/bulk-approve", () => {
    it("201 bulk approve — per-item authorization", async () => {
      const res = await post(`/orgs/${ORG}/deliverables/bulk-approve`, clientToken, {
        deliverableIds: ["del-vis", "del-other", "del-hid"],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.approved, 1); // only del-vis passes
      assert.equal(res.body.failed, 2);   // del-other (wrong tenant), del-hid (not visible)
    });
  });
});
