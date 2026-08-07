<script setup lang="ts">
// Invite acceptance for /invite/:orgId/:inviteId. Public route: signed-out
// visitors are sent to /login with a ?redirect= back here; signed-in visitors
// see the invite details and accept in place. Renders chrome-less like login.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import {
  fetchInviteApi,
  fetchInvitePreviewApi,
  type ApiError,
  type InviteInfo,
  type InvitePreview,
} from '../lib/api'
import BaseButton from '../components/BaseButton.vue'
import BrandLogo from '../components/BrandLogo.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { busy, run } = useBusy()

const orgId = computed(() => String(route.params.orgId))
const inviteId = computed(() => String(route.params.inviteId))

const info = ref<InviteInfo | null>(null)
const fetchError = ref<ApiError | null>(null)
const loading = ref(false)

// The invite is addressed to one email — accepting with another account would
// be rejected by the API anyway, so surface the mismatch up front.
const wrongAccount = computed(
  () =>
    info.value !== null &&
    auth.profile !== null &&
    info.value.email.toLowerCase() !== auth.profile.email.toLowerCase(),
)

// Signed-out visitors get the PUBLIC preview (org, role, masked email) so
// they know which account to sign up with BEFORE creating one. A dead invite
// 404s (invalid state); a plain network failure keeps the generic intro —
// don't block the sign-in path on a flaky preview.
const preview = ref<InvitePreview | null>(null)
const previewInvalid = ref(false)

async function loadInvite() {
  loading.value = true
  if (!auth.isAuthed) {
    previewInvalid.value = false
    const res = await fetchInvitePreviewApi(orgId.value, inviteId.value)
    if (res.ok) preview.value = res.data
    else if (res.error.params?.status === 404) previewInvalid.value = true
    loading.value = false
    return
  }
  fetchError.value = null
  const res = await fetchInviteApi(orgId.value, inviteId.value)
  if (res.ok) info.value = res.data
  else fetchError.value = res.error
  loading.value = false
}
onMounted(() => {
  // Login can redirect here (?redirect=/invite/…), which leaves the post-login
  // overlay up. This is a bare route with no workspace data to wait on, so
  // clear it as soon as we mount (a no-op when reached already signed in).
  auth.transitioning = false
  void loadInvite()
})

// auth.acceptInvite activates the org and routes home itself; on failure the
// translated message lands in auth.error. The one failure with its own state
// is the org being out of seats (409 seat_limit from the API).
const seatLimited = ref(false)
async function accept() {
  seatLimited.value = false
  await run(async () => {
    const res = await auth.acceptInvite(orgId.value, inviteId.value)
    if (!res.ok && res.code === 'seat_limit') seatLimited.value = true
  })
}

function goToLogin(target: 'login' | 'signup') {
  void router.push({
    path: '/login',
    query: { redirect: route.fullPath, ...(target === 'signup' ? { mode: 'signup' } : {}) },
  })
}

// Wrong account: end the session, then come back here through the login redirect.
async function switchAccount() {
  const target = route.fullPath
  await auth.logout() // replaces to /login itself
  await router.replace({ path: '/login', query: { redirect: target } })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4" style="background: var(--bg);">
    <div class="w-full max-w-sm">
      <BrandLogo class="mx-auto h-20 w-20" />
      <h1 class="font-display mt-4 text-center text-3xl tracking-tight" style="color: var(--text);">{{ t('invite.title') }}</h1>

      <!-- Signed out: route through login/signup with a redirect back here.
           The public preview names the workspace/role and hints at the
           invited address so visitors sign up with the right account. -->
      <template v-if="!auth.isAuthed">
        <p v-if="loading" class="mt-8 text-center text-sm" style="color: var(--text-muted);">{{ t('common.loading') }}</p>
        <p v-else-if="previewInvalid" class="mt-8 text-center text-sm" style="color: var(--accent-amber);">{{ t('invite.invalid') }}</p>
        <template v-else>
          <template v-if="preview">
            <p class="mt-3 text-center text-sm" style="color: var(--text-muted);">
              {{ t('invite.joinAs', { org: preview.orgName, role: t('roles.' + preview.role) }) }}
            </p>
            <p class="mt-2 text-center text-sm font-medium" style="color: var(--text);">
              {{ t('invite.useAccountFor', { email: preview.emailHint }) }}
            </p>
          </template>
          <p v-else class="mt-3 text-center text-sm" style="color: var(--text-muted);">{{ t('invite.signedOutIntro') }}</p>
          <div class="mt-8 space-y-3">
            <BaseButton class="w-full" @click="goToLogin('login')">{{ t('auth.signIn') }}</BaseButton>
            <BaseButton class="w-full" @click="goToLogin('signup')">{{ t('auth.signUp') }}</BaseButton>
          </div>
        </template>
      </template>

      <p v-else-if="loading" class="mt-8 text-center text-sm" style="color: var(--text-muted);">{{ t('common.loading') }}</p>

      <!-- Invalid / expired / revoked (or a plain request failure). -->
      <template v-else-if="fetchError">
        <p class="mt-8 text-center text-sm" style="color: var(--accent-amber);">{{ t('invite.invalid') }}</p>
        <p class="mt-2 text-center text-xs" style="color: var(--text-muted);">{{ t(fetchError.key, fetchError.params ?? {}) }}</p>
      </template>

      <!-- The workspace is out of seats: the invite can't be accepted until a
           workspace admin upgrades the plan or frees a seat. -->
      <template v-else-if="seatLimited">
        <p class="mt-8 text-center text-sm" style="color: var(--accent-amber);">{{ t('invite.seatLimit') }}</p>
      </template>

      <!-- Signed in with an account the invite wasn't addressed to. -->
      <template v-else-if="wrongAccount && info">
        <p class="mt-8 text-center text-sm" style="color: var(--accent-amber);">{{ t('invite.wrongAccount', { email: info.email }) }}</p>
        <BaseButton class="mt-4 w-full" @click="switchAccount">{{ t('invite.switchAccount') }}</BaseButton>
      </template>

      <!-- The accept flow. -->
      <template v-else-if="info">
        <p class="mt-3 text-center text-sm" style="color: var(--text-muted);">
          {{ t('invite.joinAs', { org: info.orgName, role: t('roles.' + info.role) }) }}
        </p>
        <BaseButton class="mt-8 w-full" :disabled="busy" @click="accept">
          {{ busy ? t('common.loading') : t('invite.accept') }}
        </BaseButton>
        <p v-if="auth.error" class="mt-3 text-center text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
      </template>

      <p v-if="auth.isAuthed" class="mt-8 text-center text-xs" style="color: var(--text-muted);">
        {{ t('invite.signedInAs', { email: auth.profile?.email ?? '' }) }}
      </p>
    </div>
  </div>
</template>
