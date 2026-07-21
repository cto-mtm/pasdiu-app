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
/**
 * Recount an org's members/clients/tasks with count() aggregate queries
 * (no document reads) and, when the usage doc disagrees, set the corrected
 * counters (merge — the doc may carry future fields). seats = membership
 * docs; activeClients/activeTasks = existing docs stamped with the orgId
 * (the app decrements on delete/cascade, so existence == active).
 */
export declare function reconcileOrg(orgId: string): Promise<ReconcileResult>;
/**
 * Reconcile every org, sequentially (fine at current scale — revisit with
 * batched concurrency if org count grows). select() fetches bare refs only,
 * so the sweep costs aggregate reads + one usage-doc read per org.
 */
export declare function reconcileAllOrgs(): Promise<ReconcileSummary>;
