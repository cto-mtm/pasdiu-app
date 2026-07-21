<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { hasSeenOnboarding, markOnboardingSeen } from '../lib/onboarding'
import { track } from '../lib/analytics'
import BaseButton from './BaseButton.vue'
import Modal from './Modal.vue'

// First-login product tour, once per account per device (lib/onboarding.ts).
// Mounted in App.vue behind v-if="chrome", so it can never appear on the
// login/welcome/invite/pricing bare routes — a fresh account finishes the
// /welcome workspace funnel first and meets the tour on its home route.
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const open = ref(false)
const step = ref(0)
// Same-session re-open guard; the localStorage flag is the cross-session one.
let shown = false

// Slide stems resolve to tour.{stem}Title / tour.{stem}Body keys.
const slides = computed<string[]>(() => {
  if (auth.isManager) {
    const s = ['m1', 'm2', 'm3', 'm4']
    // Upgrade pitch only for managers provably on Free — while the org doc is
    // still loading we show no pitch (never flash an upsell at a paid org).
    if (auth.org?.plan === 'free') s.push('plan')
    return s
  }
  return auth.role === 'client' ? ['cl1', 'cl2', 'cl3'] : ['c1', 'c2', 'c3']
})
const current = computed(() => slides.value[step.value])
const isLast = computed(() => step.value === slides.value.length - 1)

const eligible = computed(() => {
  const uid = auth.profile?.uid
  // Wait for the membership to resolve (role) so the slide set matches.
  return Boolean(uid && !auth.needsWorkspace && auth.role && !hasSeenOnboarding(uid))
})

watch(
  eligible,
  (ok) => {
    if (!ok || shown) return
    shown = true
    step.value = 0
    open.value = true
    track('onboarding_viewed', { role: auth.role })
  },
  { immediate: true },
)

function closeAs(event: 'onboarding_completed' | 'onboarding_skipped', props: Record<string, unknown>): void {
  const uid = auth.profile?.uid
  if (uid) markOnboardingSeen(uid)
  track(event, props)
  open.value = false
}

function finish(): void {
  closeAs('onboarding_completed', { role: auth.role })
}

// Every dismissal (skip button, esc, backdrop, ✕) marks seen — otherwise the
// eligibility watcher would re-open the tour on the next login forever.
function skip(): void {
  closeAs('onboarding_skipped', { role: auth.role, step: step.value })
}

function seePlans(): void {
  closeAs('onboarding_completed', { role: auth.role, cta: 'upgrade' })
  void router.push('/pricing')
}
</script>

<template>
  <Modal :open="open" :title="t('tour.title')" size="lg" @close="skip">
    <!-- Recipe 10: step slide (out-in, so heights never overlap). -->
    <Transition name="tour-step" mode="out-in">
      <div :key="current" class="min-h-24">
        <h3 class="text-base font-semibold" style="color: var(--text);">{{ t(`tour.${current}Title`) }}</h3>
        <p class="mt-2 text-sm" style="color: var(--text-muted);">{{ t(`tour.${current}Body`) }}</p>
        <div v-if="current === 'plan'" class="mt-4">
          <BaseButton @click="seePlans">{{ t('tour.planCta') }}</BaseButton>
        </div>
      </div>
    </Transition>

    <div class="mt-5 flex items-center justify-between">
      <div
        class="flex items-center gap-1.5"
        role="img"
        :aria-label="t('tour.stepOf', { n: step + 1, total: slides.length })"
      >
        <span
          v-for="(s, i) in slides"
          :key="s"
          class="h-1.5 w-1.5 rounded-full"
          :style="{ background: i === step ? 'var(--accent-cyan)' : 'var(--border)' }"
        />
      </div>
      <div class="flex items-center gap-3">
        <button class="text-sm" style="color: var(--text-muted);" @click="skip">{{ t('tour.skip') }}</button>
        <button v-if="step > 0" class="text-sm" style="color: var(--text-muted);" @click="step--">
          ← {{ t('tour.back') }}
        </button>
        <BaseButton v-if="!isLast" @click="step++">{{ t('tour.next') }}</BaseButton>
        <BaseButton v-else @click="finish">{{ t('tour.done') }}</BaseButton>
      </div>
    </div>
  </Modal>
</template>
