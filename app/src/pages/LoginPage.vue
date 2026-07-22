<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import { useDocumentTitle } from '../composables/useDocumentTitle'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BrandLogo from '../components/BrandLogo.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { busy, run } = useBusy()

useDocumentTitle(computed(() => t('auth.signIn')))

const email = ref('')
const password = ref('')
const displayName = ref('')

// 'login' | 'reset' | 'signup' — reset and signup reuse the email field.
// InvitePage links here with ?mode=signup for the "create account" path.
const mode = ref<'login' | 'reset' | 'signup'>(route.query.mode === 'signup' ? 'signup' : 'login')
const resetSent = ref(false)

// Seeded emulator accounts — one-click login, DEV ONLY. Gated on
// import.meta.env.DEV so the buttons (and the password literal) never render
// in production builds. These credentials must match firebase/functions/seed.mjs.
const QUICK = import.meta.env.DEV
  ? [
      { email: 'admin@pasdiu.test', roleKey: 'roles.admin' },
      { email: 'pm@pasdiu.test', roleKey: 'roles.pm' },
      { email: 'editor@pasdiu.test', roleKey: 'roles.contractor' },
      { email: 'client@pasdiu.test', roleKey: 'roles.client' },
      { email: 'north@pasdiu.test', roleKey: 'roles.admin' },
    ]
  : []
const SEED_PASSWORD = import.meta.env.DEV ? 'pasdiu123' : ''

// Where to land after a successful sign-in: honor a ?redirect= back to an
// invite link (set by InvitePage), otherwise the role home.
function inviteRedirect(): string | undefined {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/invite') ? r : undefined
}
function postLoginTarget(): string {
  return inviteRedirect() ?? auth.homeRoute()
}

async function submit() {
  await run(async () => {
    const ok = await auth.login(email.value, password.value)
    if (ok) await router.replace(postLoginTarget())
  })
}

async function googleSignIn() {
  await run(async () => {
    const ok = await auth.loginWithGoogle()
    if (ok) await router.replace(postLoginTarget())
  })
}

async function submitSignup() {
  await run(async () => {
    // Invite flow: the verification email's continue link returns to the
    // invite instead of dropping the user at the app root.
    const ok = await auth.signup(displayName.value.trim(), email.value, password.value, inviteRedirect())
    if (ok) {
      // Account created; auth.error now carries the verify-email instruction —
      // flip back to login WITHOUT clearing it so the user reads it there.
      mode.value = 'login'
      password.value = ''
    }
  })
}

async function quickLogin(e: string) {
  email.value = e
  password.value = SEED_PASSWORD
  await submit()
}

function showReset() {
  mode.value = 'reset'
  resetSent.value = false
  auth.error = null
}

function showLogin() {
  mode.value = 'login'
  auth.error = null
}

function showSignup() {
  mode.value = 'signup'
  auth.error = null
}

async function sendReset() {
  await run(async () => {
    resetSent.value = await auth.resetPassword(email.value)
  })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4" style="background: var(--bg);">
    <div class="w-full max-w-sm">
      <BrandLogo class="mx-auto h-20 w-20" />
      <h1 class="font-display mt-4 text-center text-3xl tracking-tight" style="color: var(--text);">{{ t('common.appName') }}</h1>
      <p class="mt-1 text-center text-sm" style="color: var(--text-muted);">{{ t('auth.tagline') }}</p>

      <!-- Sign-in -->
      <form v-if="mode === 'login'" class="mt-8 space-y-3" @submit.prevent="submit">
        <BaseInput v-model="email" type="email" autocomplete="username" :placeholder="t('auth.email')" />
        <BaseInput v-model="password" type="password" autocomplete="current-password" :placeholder="t('auth.password')" />
        <BaseButton type="submit" :disabled="busy" class="w-full">
          {{ busy ? t('common.loading') : t('auth.signIn') }}
        </BaseButton>
        <p v-if="auth.error" class="text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
        <div class="flex items-center justify-between">
          <button type="button" class="text-xs underline-offset-2 hover:underline" style="color: var(--text-muted);" @click="showSignup">
            {{ t('auth.noAccount') }}
          </button>
          <button type="button" class="text-xs underline-offset-2 hover:underline" style="color: var(--text-muted);" @click="showReset">
            {{ t('auth.forgot') }}
          </button>
        </div>

        <div class="flex items-center gap-3 py-1" aria-hidden="true">
          <div class="h-px flex-1" style="background: var(--border);"></div>
          <span class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('auth.or') }}</span>
          <div class="h-px flex-1" style="background: var(--border);"></div>
        </div>

        <button
          type="button"
          :disabled="busy"
          class="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style="background: var(--surface); color: var(--text); border-color: var(--border);"
          @click="googleSignIn"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          {{ t('auth.googleCta') }}
        </button>
      </form>

      <!-- Sign-up -->
      <form v-else-if="mode === 'signup'" class="mt-8 space-y-3" @submit.prevent="submitSignup">
        <BaseInput v-model="displayName" autocomplete="name" required :placeholder="t('auth.name')" />
        <BaseInput v-model="email" type="email" autocomplete="username" required :placeholder="t('auth.email')" />
        <BaseInput v-model="password" type="password" autocomplete="new-password" required minlength="8" :placeholder="t('auth.password')" />
        <BaseButton type="submit" :disabled="busy" class="w-full">
          {{ busy ? t('common.loading') : t('auth.signUp') }}
        </BaseButton>
        <p v-if="auth.error" class="text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
        <div class="text-center">
          <button type="button" class="text-xs underline-offset-2 hover:underline" style="color: var(--text-muted);" @click="showLogin">
            {{ t('auth.haveAccount') }}
          </button>
        </div>
      </form>

      <!-- Forgot password -->
      <form v-else class="mt-8 space-y-3" @submit.prevent="sendReset">
        <p class="text-sm" style="color: var(--text-muted);">{{ t('auth.resetIntro') }}</p>
        <BaseInput v-model="email" type="email" autocomplete="username" required :placeholder="t('auth.email')" />
        <BaseButton type="submit" :disabled="busy || resetSent" class="w-full">
          {{ busy ? t('common.loading') : t('auth.resetSend') }}
        </BaseButton>
        <p v-if="resetSent" class="text-sm" style="color: var(--accent-emerald);">{{ t('auth.resetSent') }}</p>
        <p v-if="auth.error" class="text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
        <div class="text-center">
          <button type="button" class="text-xs underline-offset-2 hover:underline" style="color: var(--text-muted);" @click="showLogin">
            {{ t('auth.backToSignIn') }}
          </button>
        </div>
      </form>

      <div v-if="mode === 'login' && QUICK.length" class="mt-8">
        <p class="mb-2 text-center text-xs uppercase tracking-wide" style="color: var(--text-muted);">
          {{ t('auth.quickLogin') }}
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="q in QUICK"
            :key="q.email"
            :disabled="busy"
            class="rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
            @click="quickLogin(q.email)"
          >
            {{ t(q.roleKey) }}
          </button>
        </div>
      </div>

      <p class="mt-8 text-center">
        <RouterLink
          to="/pricing"
          class="text-xs underline-offset-2 hover:underline"
          style="color: var(--text-muted);"
        >
          {{ t('auth.seePricing') }}
        </RouterLink>
      </p>
    </div>
  </div>
</template>
