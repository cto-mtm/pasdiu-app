// ── Invites of the ACTIVE org (managers only; rules enforce) ──
import { Timestamp, addDoc, collection, doc, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { i18n } from '../../i18n'
import { useAuthStore } from '../auth'
import { mapInvite } from '../../lib/mappers'
import { guarded, upsert } from './shared'
import type { DataContext } from './context'
import type { Invite, Role } from '../../lib/types'

export function createInvitesSlice(ctx: DataContext) {
  const { invites, listen, applyChanges, requireOrgId } = ctx

  // Pending AND declined: accepted/revoked are history, but a refusal is a
  // thing the manager needs to see — otherwise "they said no" is
  // indistinguishable from "they haven't opened it yet" and the invite just
  // looks stuck. Live listener: accepts/declines happen in OTHER sessions by
  // definition, so this is a surface that could never be current via pull.
  // A status change out of the pending/declined set emits `removed`.
  async function loadInvites(): Promise<void> {
    const orgId = requireOrgId()
    return listen('invites', query(
      collection(db, 'orgs', orgId, 'invites'),
      where('status', 'in', ['pending', 'declined']),
    ), (snap) => applyChanges(invites, snap, mapInvite))
  }

  async function createInvite(input: { email: string; role: Role; clientId?: string; title?: string }): Promise<Invite> {
    const orgId = requireOrgId()
    const email = input.email.toLowerCase() // rules require a lowercased email
    const invitedBy = useAuthStore().profile?.uid ?? ''
    // Inviter's current UI locale — the onInviteCreated function renders the
    // invite email in it ('en' fallback for anything unexpected).
    const locale: Invite['locale'] = i18n.global.locale.value === 'es' ? 'es' : 'en'
    // 14-day expiry, enforced server-side (preview/accept 404 past it).
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const ref = await guarded(() => addDoc(collection(db, 'orgs', orgId, 'invites'), {
      email,
      role: input.role,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.title ? { title: input.title } : {}),
      status: 'pending',
      createdAt: serverTimestamp(),
      invitedBy,
      locale,
      expiresAt: Timestamp.fromDate(expiresAt),
    }))
    const inv: Invite = {
      id: ref.id, email, role: input.role, clientId: input.clientId,
      status: 'pending', createdAt: new Date(), invitedBy, locale, expiresAt,
    }
    upsert(invites.value, inv)
    return inv
  }

  async function revokeInvite(id: string): Promise<void> {
    const orgId = requireOrgId()
    await guarded(() => updateDoc(doc(db, 'orgs', orgId, 'invites', id), { status: 'revoked' }))
    invites.value = invites.value.filter((i) => i.id !== id)
  }

  return { loadInvites, createInvite, revokeInvite }
}
