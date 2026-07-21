"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileOrg = reconcileOrg;
exports.reconcileAllOrgs = reconcileAllOrgs;
const firestore_1 = require("firebase-admin/firestore");
const v2_1 = require("firebase-functions/v2");
function counterOf(value) {
    return typeof value === "number" ? value : 0;
}
/**
 * Recount an org's members/clients/tasks with count() aggregate queries
 * (no document reads) and, when the usage doc disagrees, set the corrected
 * counters (merge — the doc may carry future fields). seats = membership
 * docs; activeClients/activeTasks = existing docs stamped with the orgId
 * (the app decrements on delete/cascade, so existence == active).
 */
async function reconcileOrg(orgId) {
    const db = (0, firestore_1.getFirestore)();
    const usageRef = db.doc(`orgs/${orgId}/usage/current`);
    const [membersAgg, clientsAgg, tasksAgg, usageSnap] = await Promise.all([
        db.collection(`orgs/${orgId}/members`).count().get(),
        db.collection("clients").where("orgId", "==", orgId).count().get(),
        db.collection("tasks").where("orgId", "==", orgId).count().get(),
        usageRef.get(),
    ]);
    const before = {
        seats: counterOf(usageSnap.get("seats")),
        activeClients: counterOf(usageSnap.get("activeClients")),
        activeTasks: counterOf(usageSnap.get("activeTasks")),
    };
    const after = {
        seats: membersAgg.data().count,
        activeClients: clientsAgg.data().count,
        activeTasks: tasksAgg.data().count,
    };
    const healed = before.seats !== after.seats ||
        before.activeClients !== after.activeClients ||
        before.activeTasks !== after.activeTasks;
    if (healed) {
        await usageRef.set(after, { merge: true });
        v2_1.logger.info("usage reconciled", { orgId, before, after });
    }
    return { orgId, healed, before, after };
}
/**
 * Reconcile every org, sequentially (fine at current scale — revisit with
 * batched concurrency if org count grows). select() fetches bare refs only,
 * so the sweep costs aggregate reads + one usage-doc read per org.
 */
async function reconcileAllOrgs() {
    const db = (0, firestore_1.getFirestore)();
    const orgRefs = await db.collection("orgs").select().get();
    const summary = { scanned: 0, healed: 0, results: [] };
    for (const doc of orgRefs.docs) {
        const result = await reconcileOrg(doc.id);
        summary.scanned += 1;
        if (result.healed) {
            summary.healed += 1;
            summary.results.push(result);
        }
    }
    return summary;
}
