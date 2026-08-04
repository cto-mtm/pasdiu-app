<script setup lang="ts">
// Onboarding: signed-in accounts with zero org memberships land here to create
// their first workspace — or to accept an invitation addressed to them.
// Renders chrome-less like the login screen — there is no org to hang the
// shell on yet.
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import type { PendingInvite } from '../lib/api'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BrandLogo from '../components/BrandLogo.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { busy, run } = useBusy()

const name = ref('')

// Invitations addressed to this account. Joining is always the invitee's own
// act — nothing here is applied automatically — so this screen is where an
// invited user says yes or no, and the email link is one route to it rather
// than the only one.
const invitesLoading = ref(true)
const acceptingId = ref('')
const decliningId = ref('')
const declineTarget = ref<PendingInvite | null>(null)

// A stale auth.error from a previous screen must not render here as if
// createOrg had failed — clear on entry (mirrors LoginPage's mode switchers).
onMounted(async () => {
  auth.error = null
  try {
    await auth.loadPendingInvites()
  } finally {
    invitesLoading.value = false
  }
})

// On success acceptInvite activates the org and routes away from here itself;
// on failure the translated reason (seat limit, expired) lands in auth.error.
async function acceptInvite(inv: PendingInvite) {
  acceptingId.value = inv.inviteId
  try {
    await run(() => auth.acceptInvite(inv.orgId, inv.inviteId))
  } finally {
    acceptingId.value = ''
  }
}

// Declining is confirmed: it is terminal (the invite can't be accepted after)
// and re-entry needs a manager to issue a fresh one, so a misclick is
// genuinely costly to the user.
async function confirmDecline() {
  const inv = declineTarget.value
  declineTarget.value = null
  if (!inv) return
  decliningId.value = inv.inviteId
  try {
    await run(() => auth.declineInvite(inv.orgId, inv.inviteId))
  } finally {
    decliningId.value = ''
  }
}

// auth.createOrg activates the new org and routes home itself; a false return
// leaves the translated message in auth.error.
async function create() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  await run(() => auth.createOrg(trimmed))
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4" style="background: var(--bg);">
    <div class="w-full max-w-sm">
      <BrandLogo class="mx-auto h-20 w-20" />

      <!-- Invitations come FIRST when there are any: someone who was invited
           is here to join a team, not to start a workspace of their own. -->
      <template v-if="auth.pendingInvites.length">
        <h1 class="font-display mt-4 text-center text-3xl tracking-tight" style="color: var(--text);">
          {{ t('onboarding.invitedTitle') }}
        </h1>

        <ul class="mt-8 space-y-3">
          <li
            v-for="inv in auth.pendingInvites"
            :key="inv.inviteId"
            class="rounded-xl border p-4"
            style="background: var(--surface); border-color: var(--border);"
          >
            <p class="text-sm" style="color: var(--text);">
              <template v-if="inv.invitedByName">
                {{ t('onboarding.invitedBy', { person: inv.invitedByName, org: inv.orgName }) }}
              </template>
              <template v-else>
                {{ t('onboarding.invitedByWorkspace', { org: inv.orgName }) }}
              </template>
            </p>
            <p class="mt-1 text-xs" style="color: var(--text-muted);">
              {{ t('onboarding.invitedAsRole', { role: t('roles.' + inv.role) }) }}
            </p>
            <div class="mt-3 flex items-center gap-2">
              <BaseButton class="flex-1" :disabled="busy" @click="acceptInvite(inv)">
                {{ acceptingId === inv.inviteId ? t('common.loading') : t('invite.accept') }}
              </BaseButton>
              <button
                type="button"
                class="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                style="background: var(--surface-2); color: var(--text-muted); border-color: var(--border);"
                :disabled="busy"
                @click="declineTarget = inv"
              >
                {{ decliningId === inv.inviteId ? t('common.loading') : t('onboarding.decline') }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="auth.error" class="mt-3 text-center text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>

        <!-- Creating a workspace stays available, just demoted. -->
        <details class="mt-8">
          <summary class="cursor-pointer text-center text-xs" style="color: var(--text-muted);">
            {{ t('onboarding.orCreateInstead') }}
          </summary>
          <form class="mt-4 space-y-3" @submit.prevent="create">
            <BaseInput v-model="name" maxlength="60" :placeholder="t('onboarding.workspaceName')" />
            <BaseButton type="submit" :disabled="busy" class="w-full">
              {{ busy ? t('common.loading') : t('onboarding.create') }}
            </BaseButton>
          </form>
        </details>
      </template>

      <!-- No invitations: the original create-a-workspace funnel. -->
      <template v-else>
        <h1 class="font-display mt-4 text-center text-3xl tracking-tight" style="color: var(--text);">{{ t('onboarding.title') }}</h1>
        <p class="mt-1 text-center text-sm" style="color: var(--text-muted);">{{ t('onboarding.subtitle') }}</p>

        <form class="mt-8 space-y-3" @submit.prevent="create">
          <BaseInput v-model="name" required maxlength="60" :placeholder="t('onboarding.workspaceName')" />
          <BaseButton type="submit" :disabled="busy" class="w-full">
            {{ busy ? t('common.loading') : t('onboarding.create') }}
          </BaseButton>
          <p v-if="auth.error" class="text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
        </form>

        <p class="mt-6 text-center text-xs" style="color: var(--text-muted);">
          {{ invitesLoading ? t('common.loading') : t('onboarding.inviteHint') }}
        </p>
      </template>

      <!-- Users can land here with the wrong account — show who they are and a way out. -->
      <ConfirmDialog
        :open="declineTarget !== null"
        danger
        :title="t('onboarding.declineTitle')"
        :message="t('onboarding.declineConfirm', { org: declineTarget?.orgName ?? '' })"
        :confirm-label="t('onboarding.decline')"
        @confirm="confirmDecline"
        @cancel="declineTarget = null"
      />

      <p class="mt-8 text-center text-xs" style="color: var(--text-muted);">
        {{ t('onboarding.signedInAs', { email: auth.profile?.email ?? '' }) }} ·
        <button type="button" class="underline-offset-2 hover:underline" style="color: var(--accent-cyan);" @click="auth.logout()">
          {{ t('auth.signOut') }}
        </button>
      </p>
    </div>
  </div>
</template>
