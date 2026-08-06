// ── Deliverables ──────────────────────────────────────────────
// NOTE: there is deliberately no "load every deliverable in this project"
// helper. The board pages by sub-group and pulls deliverables through
// loadChildrenOfSubGroups (see board.ts); an unbounded per-project load would
// silently refill the store and undo the paging on the next call.
// PackageQuota's numbers come from server-side count() aggregations, so it
// never needed the documents in the first place.
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapDeliverable } from '../../lib/mappers'
import { priorityRank } from '../../lib/types'
import { guarded, upsert } from './shared'
import type { DataContext } from './context'
import type { Deliverable } from '../../lib/types'

export function createDeliverablesSlice(ctx: DataContext) {
  const { deliverables, requireOrgId } = ctx

  // Batch order by default; `byPriority` puts high first and keeps batch order
  // as the tiebreak, so the list stays stable rather than reshuffling within a
  // priority band. Sorted here in memory — every caller already holds the
  // project's full deliverable set, so this needs no index and no extra read.
  function deliverablesForSubGroup(subGroupId: string, byPriority = false): Deliverable[] {
    return deliverables.value
      .filter((d) => d.subGroupId === subGroupId)
      .sort((a, b) => (byPriority ? priorityRank(a.priority) - priorityRank(b.priority) : 0) || a.order - b.order)
  }

  // Single deliverable by id, for surfaces that arrive at one directly (a task's
  // parent, a deep link) without having loaded its project's board.
  function getDeliverable(id: string): Deliverable | undefined {
    return deliverables.value.find((d) => d.id === id)
  }

  async function loadDeliverable(id: string): Promise<Deliverable | undefined> {
    const snap = await getDoc(doc(db, 'deliverables', id))
    if (!snap.exists()) return undefined
    const del = mapDeliverable(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (del.orgId !== requireOrgId()) return undefined
    upsert(deliverables.value, del)
    return del
  }

  async function updateDeliverable(id: string, patch: Partial<Pick<Deliverable, 'name' | 'meta' | 'order' | 'clientVisible' | 'status' | 'priority'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'deliverables', id), patch))
    const local = deliverables.value.find((d) => d.id === id)
    if (local) Object.assign(local, patch)
  }

  // What a client sees in their portal: their visible deliverables. Used by
  // the manager-facing contact profile to answer "what's sitting with them".
  // Returned to the caller (not upserted) so it never mixes with the board's
  // paged deliverable window. Index: (orgId, clientId, clientVisible).
  async function fetchClientPortalDeliverables(clientId: string): Promise<Deliverable[]> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
      where('clientVisible', '==', true),
    ))
    return snap.docs.map((d) => mapDeliverable(d.id, d.data()))
  }

  return {
    deliverablesForSubGroup, getDeliverable, loadDeliverable, updateDeliverable,
    fetchClientPortalDeliverables,
  }
}
