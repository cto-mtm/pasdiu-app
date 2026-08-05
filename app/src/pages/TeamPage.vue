<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { useEntitlements } from '../composables/useEntitlements'
import { track } from '../lib/analytics'
import { resendInviteApi } from '../lib/api'
import { ROLES } from '../lib/types'
import type { Invite, Role } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import RefreshButton from '../components/RefreshButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import UpsellModal from '../components/UpsellModal.vue'

const { t } = useI18n()
const data = useDataStore()
const auth = useAuthStore()
const toast = useToastStore()
const { canInvite } = useEntitlements()

// Active-task counts come from count() aggregations rather than loading the
// org's entire task collection to display ~10 numbers — exact at any
// workspace size, ~1 read per member instead of one per task.
const activeCounts = ref<Record<string, number>>({})
// The TEAM only — client-role members are external reviewers, managed from
// their client's page (Portal access), not from the team roster.
const members = computed(() =>
  data.teamMembers.map((u) => ({
    ...u,
    active: activeCounts.value[u.uid] ?? 0,
  })),
)
// Same split for pending invites: client invites live on the client page.
const teamInvites = computed(() => data.invites.filter((inv) => inv.role !== 'client'))

// Invite a TEAM member (admin/pm/contractor). Client contacts are invited
// from their client's page, which pins role + clientId — offering 'client'
// here forced managers to pick the client from a dropdown out of context.
const TEAM_INVITE_ROLES = ROLES.filter((r) => r !== 'client')
const showInvite = ref(false)
const showSeatUpsell = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<Role>('contractor')
const inviteTitle = ref('')
const { busy, run } = useBusy()

function openInvite() {
  // Entitlement pre-check: at the seat limit, the upsell replaces the invite
  // modal (the invite-accept API enforces it server-side too).
  if (!canInvite.value) {
    showSeatUpsell.value = true
    return
  }
  inviteEmail.value = ''
  inviteRole.value = 'contractor'
  inviteTitle.value = ''
  showInvite.value = true
}
async function saveInvite() {
  const email = inviteEmail.value.trim().toLowerCase()
  if (!email) return
  await run(async () => {
    await data.createInvite({
      email,
      role: inviteRole.value,
      ...(inviteTitle.value.trim() ? { title: inviteTitle.value.trim() } : {}),
    })
    // Viral-loop signal (BUSINESS_MODEL §7.7) — role only, never the email.
    track('invite_created', { role: inviteRole.value })
    showInvite.value = false
    toast.success(t('team.inviteCreated'))
  })
}

// Pending invites: copy link + resend + revoke. The link is bound to the
// invited email (the API rejects any other account), so the copy toast says
// so — a manager pasting it into a chat should know it isn't transferable.
async function copyLink(inv: Invite) {
  const url = `${location.origin}/invite/${auth.activeOrgId}/${inv.id}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success(t('team.linkCopied', { email: inv.email }))
  } catch {
    toast.error(t('team.copyFailed'))
  }
}

// Expired invites can't be accepted (server-side 404) — surface that state
// instead of letting managers re-share a dead link. Legacy invites without
// expiresAt never expire.
function isExpired(inv: Invite): boolean {
  return inv.expiresAt !== null && inv.expiresAt.getTime() < Date.now()
}

async function resend(inv: Invite) {
  await run(async () => {
    const orgId = auth.activeOrgId
    if (!orgId) return
    const res = await resendInviteApi(orgId, inv.id)
    if (res.ok) toast.success(t('team.inviteResent', { email: inv.email }))
    else toast.error(t(res.error.key, res.error.params ?? {}))
  })
}

const revokeTarget = ref<Invite | null>(null)
async function confirmRevoke() {
  const inv = revokeTarget.value
  revokeTarget.value = null
  if (!inv) return
  await run(() => data.revokeInvite(inv.id))
}

const loadError = ref(false)
async function load() {
  loadError.value = false
  try {
    // Roster + invites are live listeners (invite accepts made in other
    // sessions stream in); the per-member counts are one-shot aggregations,
    // which is what the refresh control re-fetches. Team uids only — client
    // contacts have no workload and no card here.
    await Promise.all([data.loadUsers(), data.loadInvites()])
    activeCounts.value = await data.fetchActiveTaskCounts(data.teamMembers.map((u) => u.uid))
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('team.title') }}</h1>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('team.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <RefreshButton :on-refresh="load" />
        <BaseButton @click="openInvite">{{ t('team.inviteMember') }}</BaseButton>
      </div>
    </div>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <p v-if="!members.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('team.empty') }}</p>

      <div v-else class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RouterLink
          v-for="m in members"
          :key="m.uid"
          :to="{ name: 'team-member', params: { uid: m.uid } }"
          class="flex items-center gap-3 rounded-xl border p-4 transition-transform hover:-translate-y-0.5"
          style="background: var(--surface); border-color: var(--border);"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style="background: var(--surface-2); color: var(--accent-cyan);"
          >
            {{ m.displayName.slice(0, 1) }}
          </div>
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 truncate text-sm font-medium" style="color: var(--text);">
              {{ m.displayName }}
              <!-- Ownership is a fact on the org doc (ownerUid), not a role —
                   surfaced here so two admins are never indistinguishable. -->
              <span
                v-if="m.uid === auth.org?.ownerUid"
                class="rounded px-1.5 py-0.5 text-xs font-medium"
                style="background: color-mix(in srgb, var(--accent-cyan) 15%, transparent); color: var(--accent-cyan);"
              >{{ t('team.owner') }}</span>
            </p>
            <p class="truncate text-xs" style="color: var(--text-muted);">
              {{ t('roles.' + m.role) }}<template v-if="m.title"> · {{ m.title }}</template>
            </p>
          </div>
          <div class="text-right">
            <p class="text-lg font-semibold" style="color: var(--text);">{{ m.active }}</p>
            <p class="text-xs" style="color: var(--text-muted);">{{ t('team.active') }}</p>
          </div>
        </RouterLink>
      </div>

      <!-- Pending TEAM invites (client invites live on their client's page) -->
      <div v-if="teamInvites.length" class="mt-8">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
          {{ t('team.pendingInvites') }} <span style="color: var(--text);">({{ teamInvites.length }})</span>
        </h2>
        <div class="mt-3 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border); background: var(--surface);">
          <div
            v-for="inv in teamInvites"
            :key="inv.id"
            class="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            style="border-color: var(--border);"
          >
            <div class="min-w-0">
              <p class="truncate text-sm" style="color: var(--text);">
                {{ inv.email }}
                <!-- Declined wins over expired: "they said no" is the useful
                     fact, and re-sending a refused invite is not the next move. -->
                <span
                  v-if="inv.status === 'declined'"
                  class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium"
                  style="background: color-mix(in srgb, var(--status-blocked) 15%, transparent); color: var(--status-blocked);"
                >{{ t('team.declined') }}</span>
                <span
                  v-else-if="isExpired(inv)"
                  class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium"
                  style="background: color-mix(in srgb, var(--accent-amber) 15%, transparent); color: var(--accent-amber);"
                >{{ t('team.expired') }}</span>
              </p>
              <p class="text-xs" style="color: var(--text-muted);">{{ t('roles.' + inv.role) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="!isExpired(inv) && inv.status !== 'declined'"
                type="button"
                :disabled="busy"
                class="rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50"
                style="color: var(--accent-cyan);"
                @click="resend(inv)"
              >
                {{ t('team.resend') }}
              </button>
              <button
                v-if="!isExpired(inv) && inv.status !== 'declined'"
                type="button"
                class="rounded-lg px-3 py-2 text-sm transition-colors"
                style="color: var(--accent-cyan);"
                :title="t('team.copyLinkHint', { email: inv.email })"
                @click="copyLink(inv)"
              >
                {{ t('team.copyLink') }}
              </button>
              <button
                type="button"
                class="rounded-lg px-3 py-2 text-sm transition-colors"
                style="color: var(--accent-amber);"
                @click="revokeTarget = inv"
              >
                {{ t('team.revoke') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Invite member -->
    <Modal :open="showInvite" :title="t('team.inviteMember')" @close="showInvite = false">
      <form class="space-y-4" @submit.prevent="saveInvite">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.emailLabel') }}</span>
          <BaseInput v-model="inviteEmail" type="email" required :placeholder="t('team.emailLabel')" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.role') }}</span>
          <BaseSelect v-model="inviteRole">
            <option v-for="r in TEAM_INVITE_ROLES" :key="r" :value="r">{{ t('roles.' + r) }}</option>
          </BaseSelect>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.titleLabel') }}</span>
          <BaseInput v-model="inviteTitle" :placeholder="t('team.titlePlaceholder')" />
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showInvite = false" @submit="saveInvite" />
      </form>
    </Modal>

    <ConfirmDialog
      :open="revokeTarget !== null"
      :title="t('team.revokeInvite')"
      :message="t('team.revokeConfirm', { email: revokeTarget?.email ?? '' })"
      danger
      :confirm-label="t('team.revoke')"
      @confirm="confirmRevoke"
      @cancel="revokeTarget = null"
    />

    <UpsellModal :open="showSeatUpsell" reason="seats" @close="showSeatUpsell = false" />
  </section>
</template>
