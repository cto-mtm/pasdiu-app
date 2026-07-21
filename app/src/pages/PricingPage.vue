<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { useDocumentTitle } from '../composables/useDocumentTitle'
import { createCheckoutApi } from '../lib/api'
import { track } from '../lib/analytics'
import { openExternal } from '../lib/native'
import { PLAN_DISPLAY_LIMITS, PLAN_PRICING, SALES_MAILTO } from '../lib/plans'
import type { GateReason } from '../composables/useEntitlements'
import type { BillingInterval, Plan } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import BrandLogo from '../components/BrandLogo.vue'
import SegmentedControl from '../components/SegmentedControl.vue'

// PUBLIC page: signed-out visitors can't call the auth-gated /billing/config,
// so prices/limits render from the constants in lib/plans.ts (mirrored from
// firebase/functions/src/plans.ts — see the sync note there).
const { t, n } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const toast = useToastStore()
const { busy, run } = useBusy()

// SEO-ish: the one public marketing page deserves a real <title>.
useDocumentTitle(computed(() => t('pricing.title')))

const interval = ref<BillingInterval>('month')

type TierId = Plan | 'enterprise'

// ?reason=clients|tasks|seats|feature — set by UpsellModal's "See plans"
// deep link when an entitlement gate fired. Renders the banner and pushes
// the Studio highlight harder.
const REASONS: readonly GateReason[] = ['clients', 'tasks', 'seats', 'feature']
const reason = computed<GateReason | null>(() => {
  const r = route.query.reason
  return typeof r === 'string' && (REASONS as readonly string[]).includes(r)
    ? (r as GateReason)
    : null
})

// Reuses the billing gate keys (same copy the UpsellModal showed). Limits
// come from the live org doc when signed in, else the Free-tier constants.
const reasonText = computed<string>(() => {
  const free = PLAN_DISPLAY_LIMITS.free
  switch (reason.value) {
    case 'clients':
      return t('billing.gateClients', { limit: auth.org?.clientLimit ?? free.clients })
    case 'tasks':
      return t('billing.gateTasks', { limit: auth.org?.taskLimit ?? free.tasks })
    case 'seats':
      return t('billing.gateSeats', { limit: auth.org?.seatLimit ?? free.seats })
    case 'feature':
      return t('billing.gateFeature')
    default:
      return ''
  }
})

// The signed-in workspace's plan; fails open to 'free' while the org doc
// loads (same convention as useEntitlements — never block paint on billing).
const currentPlan = computed<Plan>(() => auth.org?.plan ?? 'free')

// Per-seat/month display price for the selected interval (annual = the
// discounted per-month rate, billed annually).
function priceFor(plan: 'studio' | 'agency'): number {
  const p = PLAN_PRICING[plan]
  return interval.value === 'year' ? p.priceAnnual : p.priceMonthly
}

interface Tier {
  id: TierId
  name: string
  price: string
  qualifier: string
  bullets: string[]
}

const tiers = computed<Tier[]>(() => {
  const L = PLAN_DISPLAY_LIMITS
  return [
    {
      id: 'free',
      name: t('pricing.tierFree'),
      price: t('pricing.priceFree'),
      qualifier: t('pricing.qualFree'),
      bullets: [
        t('pricing.featSeats', { n: L.free.seats }),
        t('pricing.featClients', { n: L.free.clients }),
        t('pricing.featTasks', { n: n(L.free.tasks) }),
        t('pricing.featClientUsers'),
        t('pricing.featCore'),
      ],
    },
    {
      id: 'studio',
      name: t('pricing.tierStudio'),
      price: t('pricing.priceAmount', { price: priceFor('studio') }),
      qualifier: t('pricing.perSeatMo'),
      bullets: [
        t('pricing.featSeatsUpTo', { n: L.studio.seats }),
        t('pricing.featClients', { n: L.studio.clients }),
        t('pricing.featTasks', { n: n(L.studio.tasks) }),
        t('pricing.featClientUsers'),
        t('pricing.featLedger'),
        t('pricing.featAnalyticsImport'),
      ],
    },
    {
      id: 'agency',
      name: t('pricing.tierAgency'),
      price: t('pricing.priceAmount', { price: priceFor('agency') }),
      qualifier: t('pricing.perSeatMo'),
      bullets: [
        t('pricing.featSeatsUpTo', { n: L.agency.seats }),
        t('pricing.featClientsUnlimited'),
        t('pricing.featTasksUnlimited'),
        t('pricing.featClientUsers'),
        t('pricing.featEverythingStudio'),
        t('pricing.featSso'),
      ],
    },
    {
      id: 'enterprise',
      name: t('pricing.tierEnterprise'),
      price: t('pricing.priceCustom'),
      qualifier: t('pricing.qualEnterprise'),
      bullets: [
        t('pricing.featSeatsUnlimited'),
        t('pricing.featClientsUnlimited'),
        t('pricing.featSso'),
        t('pricing.featAudit'),
        t('pricing.featSupportSla'),
      ],
    },
  ]
})

const faqs = computed(() => [
  { q: t('pricing.faqClientsQ'), a: t('pricing.faqClientsA') },
  { q: t('pricing.faqActiveQ'), a: t('pricing.faqActiveA') },
  { q: t('pricing.faqCancelQ'), a: t('pricing.faqCancelA') },
  { q: t('pricing.faqSeatsQ'), a: t('pricing.faqSeatsA') },
])

// Same checkout pattern as the Settings billing card: full-page redirect to
// the Stripe-hosted URL; failures toast and the button un-busies.
async function checkout(plan: TierId): Promise<void> {
  if (plan !== 'studio' && plan !== 'agency') return
  // Funnel: fired at the click (before the redirect), not on Stripe's return.
  track('checkout_started', { plan, interval: interval.value, source: 'pricing' })
  await run(async () => {
    const res = await createCheckoutApi(auth.activeOrgId ?? '', plan, interval.value)
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    await openExternal(res.data.url)
  })
}
</script>

<template>
  <!-- Standard Recipe 1 cross-fade — deliberately no view-transition-name. -->
  <div class="min-h-screen" style="background: var(--bg);">
    <!-- Minimal own header: the page renders chrome-less (App.vue bare list). -->
    <header class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
      <RouterLink to="/" class="flex items-center gap-2">
        <BrandLogo class="h-8 w-8" />
        <span class="font-display text-lg tracking-tight" style="color: var(--text);">{{ t('common.appName') }}</span>
      </RouterLink>
      <RouterLink
        v-if="!auth.isAuthed"
        to="/login"
        class="text-sm underline-offset-2 hover:underline"
        style="color: var(--text-muted);"
      >
        {{ t('auth.signIn') }}
      </RouterLink>
      <RouterLink
        v-else
        :to="auth.homeRoute()"
        class="text-sm underline-offset-2 hover:underline"
        style="color: var(--text-muted);"
      >
        {{ t('pricing.backToApp') }}
      </RouterLink>
    </header>

    <main class="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <h1 class="text-center text-3xl font-bold tracking-tight" style="color: var(--text);">{{ t('pricing.title') }}</h1>
      <p class="mx-auto mt-2 max-w-xl text-center text-sm" style="color: var(--text-muted);">{{ t('pricing.subtitle') }}</p>

      <!-- The headline differentiator: reviewers are free on every tier. -->
      <p
        class="mx-auto mt-5 w-fit rounded-full border px-4 py-1.5 text-center text-sm font-medium"
        style="border-color: var(--accent-emerald); color: var(--accent-emerald); background: var(--surface);"
      >
        {{ t('pricing.clientUsersBanner') }}
      </p>

      <!-- Gate banner (?reason=… from UpsellModal). -->
      <div
        v-if="reason"
        class="mx-auto mt-6 max-w-2xl rounded-xl border px-4 py-3 text-center text-sm"
        style="border-color: var(--accent-amber); background: var(--surface); color: var(--text);"
      >
        {{ reasonText }}
      </div>

      <!-- Interval toggle -->
      <div class="mt-8 flex items-center justify-center gap-3">
        <SegmentedControl
          v-model="interval"
          :options="[
            { value: 'month', label: t('billing.intervalMonthly') },
            { value: 'year', label: t('billing.intervalAnnual') },
          ]"
        />
        <span
          class="rounded-full border px-2 py-0.5 text-xs"
          style="border-color: var(--accent-emerald); color: var(--accent-emerald);"
        >
          {{ t('pricing.saveTag') }}
        </span>
      </div>
      <p v-if="interval === 'year'" class="mt-2 text-center text-xs" style="color: var(--text-muted);">
        {{ t('pricing.billedAnnually') }}
      </p>

      <!-- Tier cards -->
      <div class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="tier in tiers"
          :key="tier.id"
          class="relative flex flex-col rounded-2xl border p-5"
          :style="{
            background: 'var(--surface)',
            borderColor: tier.id === 'studio' ? 'var(--accent-cyan)' : 'var(--border)',
            boxShadow: tier.id === 'studio' && reason ? '0 0 0 1px var(--accent-cyan)' : 'none',
          }"
        >
          <span
            v-if="tier.id === 'studio'"
            class="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
            style="background: var(--accent-cyan); color: var(--bg);"
          >
            {{ t('pricing.mostPopular') }}
          </span>

          <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ tier.name }}</h2>
          <p class="mt-2 text-3xl font-bold tracking-tight" style="color: var(--text);">{{ tier.price }}</p>
          <p class="mt-0.5 text-xs" style="color: var(--text-muted);">{{ tier.qualifier }}</p>
          <p
            v-if="interval === 'year' && (tier.id === 'studio' || tier.id === 'agency')"
            class="mt-0.5 text-xs"
            style="color: var(--text-muted);"
          >
            {{ t('pricing.billedAnnually') }}
          </p>

          <ul class="mt-4 flex-1 space-y-2 text-sm">
            <li v-for="b in tier.bullets" :key="b" class="flex gap-2">
              <span aria-hidden="true" style="color: var(--accent-cyan);">✓</span>
              <span style="color: var(--text);">{{ b }}</span>
            </li>
          </ul>

          <!-- CTA — branches on auth/plan/role state. -->
          <div class="mt-5">
            <!-- Enterprise is contact-only on every state. -->
            <a
              v-if="tier.id === 'enterprise'"
              :href="SALES_MAILTO"
              class="inline-flex w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
              style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            >
              {{ t('pricing.ctaContact') }}
            </a>

            <!-- Signed out: every self-serve tier starts with an account. -->
            <RouterLink
              v-else-if="!auth.isAuthed"
              :to="{ path: '/login', query: { mode: 'signup' } }"
              class="inline-flex w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
              :style="{
                background: tier.id === 'studio' ? 'var(--accent-cyan)' : 'var(--surface-2)',
                color: tier.id === 'studio' ? 'var(--bg)' : 'var(--text)',
                borderColor: tier.id === 'studio' ? 'var(--accent-cyan)' : 'var(--border)',
              }"
            >
              {{ tier.id === 'free' ? t('pricing.ctaStartFree') : t('pricing.ctaGetStarted') }}
            </RouterLink>

            <!-- Signed in, on this plan already. -->
            <BaseButton v-else-if="tier.id === currentPlan" disabled class="w-full">
              {{ t('pricing.ctaCurrent') }}
            </BaseButton>

            <!-- Signed in on a paid plan: downgrades to Free (and plan
                 changes) live in the Stripe portal, reached via Settings. -->
            <RouterLink
              v-else-if="tier.id === 'free' || currentPlan !== 'free'"
              to="/settings"
              class="inline-block text-sm underline-offset-2 hover:underline"
              style="color: var(--text-muted);"
            >
              {{ t('billing.manage') }}
            </RouterLink>

            <!-- Signed in on Free, but only managers can upgrade. -->
            <p v-else-if="!auth.isManager" class="text-xs" style="color: var(--text-muted);">
              {{ t('billing.askAdmin') }}
            </p>

            <!-- Signed in manager on Free: straight to checkout. -->
            <BaseButton
              v-else
              :disabled="busy"
              class="w-full"
              :style="tier.id === 'studio' ? { background: 'var(--accent-cyan)', color: 'var(--bg)', borderColor: 'var(--accent-cyan)' } : {}"
              @click="checkout(tier.id)"
            >
              {{ t('pricing.ctaUpgrade', { plan: tier.name }) }}
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- FAQ -->
      <section class="mx-auto mt-14 max-w-3xl">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('pricing.faqTitle') }}</h2>
        <dl class="mt-4 space-y-5">
          <div v-for="f in faqs" :key="f.q">
            <dt class="text-sm font-medium" style="color: var(--text);">{{ f.q }}</dt>
            <dd class="mt-1 text-sm" style="color: var(--text-muted);">{{ f.a }}</dd>
          </div>
        </dl>
      </section>
    </main>
  </div>
</template>
