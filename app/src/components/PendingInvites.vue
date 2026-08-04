<script setup lang="ts">
// Invitations addressed to this account, rendered inside the app shell beside
// the workspace switcher: the switcher lists the workspaces you're in, so the
// ones asking you to join belong next to it.
//
// This is the surface for people who ALREADY have a workspace. /welcome covers
// the other case and owns the full-page treatment; this one is deliberately
// compact — it lives in a ~13rem sidebar column, so it names the workspace
// first and keeps the sentence short.
//
// Joining stays the invitee's own act (see the store's loadPendingInvites),
// and declining is confirmed here for the same reason it is on /welcome: it is
// terminal, and re-entry needs a manager to issue a fresh invitation.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import type { PendingInvite } from '../lib/api'
import ConfirmDialog from './ConfirmDialog.vue'

const { t } = useI18n()
const auth = useAuthStore()
const toast = useToastStore()

// Per-invite, not a single flag: acting on one row must not freeze the others.
const acceptingId = ref('')
const decliningId = ref('')
const declineTarget = ref<PendingInvite | null>(null)

// The shell has no error slot of its own, so failures go to a toast and
// auth.error is cleared — otherwise a stale message follows the user onto the
// next screen that does render it.
function reportAndClear(fallback: string) {
  toast.error(auth.error ?? fallback)
  auth.error = null
}

// acceptInvite activates the org and routes home itself, so success needs no
// state here; only the failure path (revoked, expired, seat limit) surfaces.
async function accept(inv: PendingInvite) {
  if (acceptingId.value || decliningId.value) return
  acceptingId.value = inv.inviteId
  try {
    const res = await auth.acceptInvite(inv.orgId, inv.inviteId)
    if (!res.ok) reportAndClear(t('invite.invalid'))
  } finally {
    acceptingId.value = ''
  }
}

async function confirmDecline() {
  const inv = declineTarget.value
  declineTarget.value = null
  if (!inv) return
  decliningId.value = inv.inviteId
  try {
    const ok = await auth.declineInvite(inv.orgId, inv.inviteId)
    if (!ok) reportAndClear(t('shell.invitationDeclineFailed'))
  } finally {
    decliningId.value = ''
  }
}
</script>

<template>
  <section v-if="auth.pendingInvites.length">
    <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">
      {{ t('shell.invitations') }}
      <span style="color: var(--text);">({{ auth.pendingInvites.length }})</span>
    </span>

    <ul class="space-y-2">
      <li
        v-for="inv in auth.pendingInvites"
        :key="inv.inviteId"
        class="rounded-lg border p-2.5"
        style="background: var(--surface-2); border-color: var(--border);"
      >
        <p class="truncate text-sm font-medium" style="color: var(--text);">{{ inv.orgName }}</p>
        <p class="text-xs" style="color: var(--text-muted);">
          {{ t('onboarding.invitedAsRole', { role: t('roles.' + inv.role) }) }}
        </p>
        <!-- Omitted when the API couldn't resolve the inviter (they left the
             org, or the invite predates invitedBy) — never guess a name. -->
        <p v-if="inv.invitedByName" class="truncate text-xs" style="color: var(--text-muted);">
          {{ t('shell.invitedByShort', { person: inv.invitedByName }) }}
        </p>

        <div class="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); color: var(--accent-cyan); border-color: var(--accent-cyan);"
            :disabled="acceptingId !== '' || decliningId !== ''"
            @click="accept(inv)"
          >
            {{ acceptingId === inv.inviteId ? t('common.loading') : t('shell.invitationJoin') }}
          </button>
          <button
            type="button"
            class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style="background: var(--surface); color: var(--text-muted); border-color: var(--border);"
            :disabled="acceptingId !== '' || decliningId !== ''"
            @click="declineTarget = inv"
          >
            {{ decliningId === inv.inviteId ? t('common.loading') : t('onboarding.decline') }}
          </button>
        </div>
      </li>
    </ul>

    <!-- Same copy as /welcome: declining means the same thing on both screens. -->
    <ConfirmDialog
      :open="declineTarget !== null"
      danger
      :title="t('onboarding.declineTitle')"
      :message="t('onboarding.declineConfirm', { org: declineTarget?.orgName ?? '' })"
      :confirm-label="t('onboarding.decline')"
      @confirm="confirmDecline"
      @cancel="declineTarget = null"
    />
  </section>
</template>
