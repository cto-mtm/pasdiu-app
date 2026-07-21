import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

// Usage-counter reconciliation (PAYWALL_PLAN Phase 2/4). The entitlement
// gates in firestore.rules compare orgs/{orgId}/usage/current against the
// org's plan limits, but the counter *increments* written by the app are not
// value-validated by rules (managers-only writes — accepted trade-off,
// documented in the rules), so drift is possible. This module is the healer:
// recount reality with aggregate queries and overwrite the counters.

/** The three counters on orgs/{orgId}/usage/current. */
export interface UsageCounters {
  seats: number;
  activeClients: number;
  activeTasks: number;
}

export interface ReconcileResult {
  orgId: string;
  /** True when at least one counter was wrong and has been corrected. */
  healed: boolean;
  before: UsageCounters;
  after: UsageCounters;
}

export interface ReconcileSummary {
  scanned: number;
  healed: number;
  /** One entry per healed org (drift details) — clean orgs are omitted. */
  results: ReconcileResult[];
}

function counterOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * Recount an org's members/clients/tasks with count() aggregate queries
 * (no document reads) and, when the usage doc disagrees, set the corrected
 * counters (merge — the doc may carry future fields). seats = membership
 * docs; activeClients/activeTasks = existing docs stamped with the orgId
 * (the app decrements on delete/cascade, so existence == active).
 */
export async function reconcileOrg(orgId: string): Promise<ReconcileResult> {
  const db = getFirestore();
  const usageRef = db.doc(`orgs/${orgId}/usage/current`);
  const [membersAgg, clientsAgg, tasksAgg, usageSnap] = await Promise.all([
    db.collection(`orgs/${orgId}/members`).count().get(),
    db.collection("clients").where("orgId", "==", orgId).count().get(),
    db.collection("tasks").where("orgId", "==", orgId).count().get(),
    usageRef.get(),
  ]);

  const before: UsageCounters = {
    seats: counterOf(usageSnap.get("seats")),
    activeClients: counterOf(usageSnap.get("activeClients")),
    activeTasks: counterOf(usageSnap.get("activeTasks")),
  };
  const after: UsageCounters = {
    seats: membersAgg.data().count,
    activeClients: clientsAgg.data().count,
    activeTasks: tasksAgg.data().count,
  };

  const healed =
    before.seats !== after.seats ||
    before.activeClients !== after.activeClients ||
    before.activeTasks !== after.activeTasks;

  if (healed) {
    await usageRef.set(after, { merge: true });
    logger.info("usage reconciled", { orgId, before, after });
  }
  return { orgId, healed, before, after };
}

/**
 * Reconcile every org, sequentially (fine at current scale — revisit with
 * batched concurrency if org count grows). select() fetches bare refs only,
 * so the sweep costs aggregate reads + one usage-doc read per org.
 */
export async function reconcileAllOrgs(): Promise<ReconcileSummary> {
  const db = getFirestore();
  const orgRefs = await db.collection("orgs").select().get();
  const summary: ReconcileSummary = { scanned: 0, healed: 0, results: [] };
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
