// ── Clients ───────────────────────────────────────────────────
import { collection, doc, getDoc, increment, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapClient } from '../../lib/mappers'
import { track } from '../../lib/analytics'
import { guarded, upsert } from './shared'
import type { DataContext } from './context'
import type { Client, MetaField } from '../../lib/types'

export function createClientsSlice(ctx: DataContext) {
  const { clients, listen, applyChanges, requireOrgId, usageRef } = ctx

  // Live listener over the whole org's clients (unpaged — an agency's client
  // roster is dozens, not thousands).
  async function loadClients(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('clients', query(collection(db, 'clients'), where('orgId', '==', orgId)), (snap) => {
      applyChanges(clients, snap, mapClient)
    })
  }

  // Single client by id (rule-compatible for the client role, which can't run
  // an unfiltered clients query).
  async function loadClient(id: string): Promise<void> {
    const snap = await getDoc(doc(db, 'clients', id))
    if (!snap.exists()) return
    const c = mapClient(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (c.orgId !== requireOrgId()) return
    upsert(clients.value, c)
  }

  function getClient(id: string): Client | undefined {
    return clients.value.find((c) => c.id === id)
  }

  // Client/task creates commit as a writeBatch: the new doc + a +1 on the
  // matching usage counter, atomically — rules (via getAfter on the usage
  // doc) require the same-batch increment on client/task creates and deny
  // the create at the plan limit.
  async function createClient(name: string, meta: MetaField[] = []): Promise<Client> {
    const orgId = requireOrgId()
    const ref = doc(collection(db, 'clients'))
    await guarded(() => {
      const batch = writeBatch(db)
      batch.set(ref, { orgId, name, meta })
      batch.update(usageRef(orgId), { activeClients: increment(1) })
      return batch.commit()
    })
    // Activation signal (BUSINESS_MODEL §7.2) — org id only, never the name.
    track('client_created', { orgId })
    const c: Client = { id: ref.id, orgId, name, meta }
    upsert(clients.value, c)
    return c
  }

  async function updateClient(id: string, patch: Partial<Pick<Client, 'name' | 'meta'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'clients', id), patch))
    const local = getClient(id)
    if (local) Object.assign(local, patch)
  }

  return { loadClients, loadClient, getClient, createClient, updateClient }
}
