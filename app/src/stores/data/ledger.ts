// ── Ledger (completed work; scoped + paged) ───────────────────
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapTask } from '../../lib/mappers'
import { DONE_STATUSES } from '../../lib/status'
import { createPaginator, upsert } from './shared'
import type { DataContext } from './context'

const LEDGER_PAGE_SIZE = 200

export function createLedgerSlice(ctx: DataContext) {
  const { ledgerTasks, isFresh, markLoaded, requireOrgId, onReset } = ctx

  const paginator = createPaginator(onReset, LEDGER_PAGE_SIZE)

  async function loadLedger(force = false): Promise<void> {
    if (!force && isFresh('ledger')) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', DONE_STATUSES),
      orderBy('completedAt', 'desc'),
      limit(LEDGER_PAGE_SIZE),
    ))
    ledgerTasks.value = snap.docs.map((d) => mapTask(d.id, d.data()))
    paginator.applyCursor(snap.docs)
    markLoaded('ledger')
  }

  async function loadMoreLedger(): Promise<void> {
    if (!paginator.canLoadMore()) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', DONE_STATUSES),
      orderBy('completedAt', 'desc'),
      startAfter(paginator.getCursor()),
      limit(LEDGER_PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(ledgerTasks.value, mapTask(d.id, d.data())))
    paginator.applyCursor(snap.docs)
  }

  return { ledgerMayHaveMore: paginator.mayHaveMore, loadLedger, loadMoreLedger }
}
