// ── Members of the active org (assignee/author name lookups) ──
import { computed } from 'vue'
import { collection, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapMember } from '../../lib/mappers'
import { guarded } from './shared'
import type { DataContext } from './context'
import type { UserProfile } from '../../lib/types'

export function createMembersSlice(ctx: DataContext) {
  const { usersById, listen, requireOrgId } = ctx

  // Kept as `loadUsers`/`usersById` so existing pages keep working; the data
  // comes from orgs/{orgId}/members. Live listener: invite accepts and
  // removals made by other sessions land here without a manual refresh.
  // `force` is accepted for signature compatibility — live data has nothing
  // to force.
  async function loadUsers(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('users', collection(db, 'orgs', orgId, 'members'), (snap) => {
      for (const c of snap.docChanges()) {
        if (c.type === 'removed') {
          const next = { ...usersById.value }
          delete next[c.doc.id]
          usersById.value = next
        } else {
          usersById.value = { ...usersById.value, [c.doc.id]: mapMember(c.doc.id, c.doc.data()) }
        }
      }
    })
  }

  function userName(uid: string): string {
    return usersById.value[uid]?.displayName ?? '—'
  }

  // Assignable roster: everyone on the team (admins, PMs, contractors).
  // Client-role members are external reviewers, never assignees.
  const teamMembers = computed<UserProfile[]>(() =>
    Object.values(usersById.value).filter((u) => u.role !== 'client'),
  )

  // Edits a member of the ACTIVE org (orgs/{orgId}/members/{uid}) — managers
  // may change role/clientId/displayName; membership create/delete goes
  // through the HTTP API.
  async function updateMember(uid: string, patch: Partial<Pick<UserProfile, 'displayName' | 'role' | 'clientId' | 'title'>>): Promise<void> {
    const orgId = requireOrgId()
    await guarded(() => updateDoc(doc(db, 'orgs', orgId, 'members', uid), patch))
    const current = usersById.value[uid]
    if (current) usersById.value = { ...usersById.value, [uid]: { ...current, ...patch } }
  }

  return { loadUsers, userName, teamMembers, updateMember }
}
