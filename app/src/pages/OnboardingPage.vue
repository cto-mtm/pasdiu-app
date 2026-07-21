<script setup lang="ts">
// Onboarding: signed-in accounts with zero org memberships land here to create
// their first workspace (or follow an invite link instead). Renders chrome-less
// like the login screen — there is no org to hang the shell on yet.
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BrandLogo from '../components/BrandLogo.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { busy, run } = useBusy()

const name = ref('')

// A stale auth.error from a previous screen must not render here as if
// createOrg had failed — clear on entry (mirrors LoginPage's mode switchers).
onMounted(() => { auth.error = null })

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
      <h1 class="font-display mt-4 text-center text-3xl tracking-tight" style="color: var(--text);">{{ t('onboarding.title') }}</h1>
      <p class="mt-1 text-center text-sm" style="color: var(--text-muted);">{{ t('onboarding.subtitle') }}</p>

      <form class="mt-8 space-y-3" @submit.prevent="create">
        <BaseInput v-model="name" required maxlength="60" :placeholder="t('onboarding.workspaceName')" />
        <BaseButton type="submit" :disabled="busy" class="w-full">
          {{ busy ? t('common.loading') : t('onboarding.create') }}
        </BaseButton>
        <p v-if="auth.error" class="text-sm" style="color: var(--accent-amber);">{{ auth.error }}</p>
      </form>

      <p class="mt-6 text-center text-xs" style="color: var(--text-muted);">{{ t('onboarding.inviteHint') }}</p>

      <!-- Users can land here with the wrong account — show who they are and a way out. -->
      <p class="mt-8 text-center text-xs" style="color: var(--text-muted);">
        {{ t('onboarding.signedInAs', { email: auth.profile?.email ?? '' }) }} ·
        <button type="button" class="underline-offset-2 hover:underline" style="color: var(--accent-cyan);" @click="auth.logout()">
          {{ t('auth.signOut') }}
        </button>
      </p>
    </div>
  </div>
</template>
