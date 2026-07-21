<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useApi } from '../composables/useApi'
import { useBusy } from '../composables/useBusy'
import { useDocumentTitle } from '../composables/useDocumentTitle'
import { useEntitlements } from '../composables/useEntitlements'
import { createCheckoutApi, createPortalApi, removeMemberApi } from '../lib/api'
import { track } from '../lib/analytics'
import { openExternal } from '../lib/native'
import type { BillingConfig, BillingInterval, Plan } from '../lib/types'
import LocaleSwitcher from '../components/LocaleSwitcher.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import ImportWizard from '../components/ImportWizard.vue'

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()
// Entitlements: `has` gates the import card; usage/limits feed the billing
// card's usage bars (live org + usage subscriptions in the auth store).
const { has, usage, limits } = useEntitlements()

useDocumentTitle(computed(() => t('settings.title')))

const showImport = ref(false)

// ── Workspace rename (managers) ─────────────────────────────────
// The input tracks the live org name (the doc can arrive after mount or be
// renamed by another manager) but stops syncing once the user starts editing.
const currentOrgName = computed(() => auth.org?.name ?? auth.activeMembership?.orgName ?? '')
const orgName = ref('')
const userEditing = ref(false)
watch(currentOrgName, (n) => { if (!userEditing.value) orgName.value = n }, { immediate: true })
const { busy: renameBusy, run: runRename } = useBusy()
const nameDirty = computed(() => {
  const next = orgName.value.trim()
  return next.length > 0 && next.length <= 60 && next !== currentOrgName.value
})

// Mark editing on first keystroke; reset after a successful save.
function onNameInput(value: string): void {
  orgName.value = value
  userEditing.value = true
}

async function saveOrgName(): Promise<void> {
  await runRename(async () => {
    const ok = await auth.renameOrg(orgName.value.trim())
    if (ok) {
      userEditing.value = false
      toast.success(t('settings.renamed'))
    } else {
      toast.error(auth.error ?? t('common.saveError'))
    }
  })
}

// Usage bars: one row per counter. -1 = unlimited (no bar, translatable
// "unlimited" label); the fill fraction is clamped so an over-limit
// workspace (post-downgrade) doesn't overflow the track.
const usageRows = computed(() => {
  const u = usage.value
  const l = limits.value
  if (!u || !l) return []
  return [
    { key: 'seats', label: t('billing.usageSeats'), used: u.seats, limit: l.seats },
    { key: 'clients', label: t('billing.usageClients'), used: u.activeClients, limit: l.clients },
    { key: 'tasks', label: t('billing.usageTasks'), used: u.activeTasks, limit: l.tasks },
  ].map((r) => ({
    ...r,
    frac: r.limit > 0 ? Math.min(r.used / r.limit, 1) : 0,
  }))
})

// Calls GET /health on the Cloud Function — proves the full app→API path,
// against the emulator in local dev.
interface Health { ok: boolean; ts: string }
const { data: health, error: healthError, loading: healthLoading, execute: checkHealth } = useApi<Health>('/health')

// ── Billing (managers) ──────────────────────────────────────────
// Plan/limits/prices come from GET /billing/config; the org's live plan comes
// from the auth store's org-doc subscription, so a webhook-driven upgrade
// updates this card without a reload.
const {
  data: billingConfig,
  error: billingError,
  loading: billingLoading,
  execute: loadBillingConfig,
} = useApi<BillingConfig>('/billing/config')

const interval = ref<BillingInterval>('month')
const { busy: billingBusy, run: runBilling } = useBusy()

const isPaidPlan = computed(() => auth.org !== null && auth.org.plan !== 'free')

// Enum display name via keys (i18n rule: data is translated through keys).
const PLAN_KEYS = {
  free: 'billing.planFree',
  studio: 'billing.planStudio',
  agency: 'billing.planAgency',
} as const satisfies Record<Plan, string>
const planLabel = computed(() => t(PLAN_KEYS[auth.org?.plan ?? 'free']))

// Per-seat/month display price for the selected interval (annual = the
// discounted per-month price, billed annually).
function priceFor(plan: 'studio' | 'agency'): number {
  const p = billingConfig.value?.plans[plan]
  if (!p) return 0
  return interval.value === 'year' ? p.priceAnnual : p.priceMonthly
}

// Checkout/portal both end in a full-page redirect to a Stripe-hosted URL;
// failures surface as toasts and the button un-busies.
async function upgrade(plan: 'studio' | 'agency'): Promise<void> {
  // Funnel: fired at the click (before the redirect), not on Stripe's return.
  track('checkout_started', { plan, interval: interval.value, source: 'settings' })
  await runBilling(async () => {
    const res = await createCheckoutApi(auth.activeOrgId ?? '', plan, interval.value)
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    await openExternal(res.data.url)
  })
}

async function openPortal(): Promise<void> {
  await runBilling(async () => {
    const res = await createPortalApi(auth.activeOrgId ?? '')
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    await openExternal(res.data.url)
  })
}

// Checkout return (?billing=success|cancelled): toast on success — the org
// doc updates live via the webhook, so the card self-updates — then scrub the
// param so a refresh doesn't re-toast. Cancelled is a deliberate no-op.
function handleCheckoutReturn(): void {
  if (!('billing' in route.query)) return
  if (route.query.billing === 'success') {
    // Funnel prop: the webhook updates the org doc before the user usually
    // returns, so this is the purchased plan (occasionally still 'free').
    track('checkout_completed', { plan: auth.org?.plan })
    toast.success(t('billing.checkoutSuccess'))
  }
  const query = { ...route.query }
  delete query.billing
  void router.replace({ query })
}

// ── Leave workspace (non-owners) ────────────────────────────────
// Self-removal through the same members API managers use to remove others
// (it allows uid === self and 409s for the owner). Hidden for the owner —
// ownerUid lives on the org doc — and until the org doc has loaded, since
// showing it to an undetermined owner would only invite that 409.
const canLeave = computed(
  () => auth.org !== null && auth.profile !== null && auth.org.ownerUid !== auth.profile.uid,
)
const showLeave = ref(false)
const { busy: leaveBusy, run: runLeave } = useBusy()

async function confirmLeave(): Promise<void> {
  showLeave.value = false
  await runLeave(async () => {
    const orgId = auth.activeOrgId
    const uid = auth.profile?.uid
    if (!orgId || !uid) return
    const res = await removeMemberApi(orgId, uid)
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    track('workspace_left')
    // refreshMemberships → ensureActiveOrg notices the active org is gone,
    // resets the data store, and routes to the next org's home (or /welcome
    // when this was the only workspace).
    try {
      await auth.refreshMemberships()
    } catch {
      // The removal already succeeded — don't swallow the failed
      // revalidation; the router guard sorts the rest out on navigation.
      toast.error(t('common.loadError'))
    }
  })
}

onMounted(() => {
  void checkHealth()
  // Unconditional: the ?billing param must be scrubbed (and the success
  // toast shown) for every role, not just managers — the return URL doesn't
  // know who's signed in. The billing-config load stays manager-only.
  handleCheckoutReturn()
  if (auth.isManager) void loadBillingConfig()
})
</script>

<template>
  <!-- 'settings-page' name enables the Recipe 2b slide-in (see transitions.css).
       mx-auto: the shell's <main> is a wide centered container — without it
       this column piles up on the left and leaves the right half empty. -->
  <section class="mx-auto max-w-2xl" style="view-transition-name: settings-page;">
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('settings.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('settings.subtitle') }}</p>

    <div class="mt-6 space-y-4">
      <!-- Profile -->
      <div class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.profile') }}</h2>
        <dl class="mt-3 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt style="color: var(--text-muted);">{{ t('settings.name') }}</dt>
            <dd style="color: var(--text);">{{ auth.profile?.displayName || t('common.userFallback') }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt style="color: var(--text-muted);">{{ t('settings.email') }}</dt>
            <dd style="color: var(--text);">{{ auth.profile?.email }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt style="color: var(--text-muted);">{{ t('settings.workspace') }}</dt>
            <dd style="color: var(--text);">{{ auth.activeMembership?.orgName }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt style="color: var(--text-muted);">{{ t('settings.role') }}</dt>
            <dd style="color: var(--text);">{{ t('roles.' + (auth.role ?? 'contractor')) }}</dd>
          </div>
        </dl>
      </div>

      <!-- Preferences -->
      <div class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.language') }}</h2>
        <div class="mt-3"><LocaleSwitcher /></div>
      </div>

      <!-- Workspace (managers): rename. The API fans the new name out to the
           denormalized member docs, so the switcher updates for everyone. -->
      <div v-if="auth.isManager" class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.workspace') }}</h2>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('settings.renameHint') }}</p>
        <form class="mt-3 flex items-center gap-2" @submit.prevent="saveOrgName">
          <BaseInput :modelValue="orgName" @update:modelValue="onNameInput" class="flex-1" maxlength="60" required />
          <BaseButton type="submit" :disabled="renameBusy || !nameDirty">
            {{ renameBusy ? t('common.loading') : t('settings.renameCta') }}
          </BaseButton>
        </form>
      </div>

      <!-- Import (managers; paid plans only — the wizard stays unmountable on Free) -->
      <div v-if="auth.isManager" class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('import.title') }}</h2>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('import.settingsHint') }}</p>
        <BaseButton v-if="has('import')" class="mt-3" @click="showImport = true">{{ t('import.open') }}</BaseButton>
        <p v-else class="mt-3 text-sm" style="color: var(--accent-amber);">{{ t('billing.importLocked') }}</p>
      </div>

      <!-- Billing (managers): current plan + upgrade/portal -->
      <div v-if="auth.isManager" class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('billing.title') }}</h2>

        <!-- Usage vs limits (live Firestore counters — independent of Stripe config). -->
        <div v-if="usageRows.length" class="mt-3 space-y-3">
          <div v-for="row in usageRows" :key="row.key">
            <div class="flex items-baseline justify-between gap-4 text-sm">
              <span style="color: var(--text-muted);">{{ row.label }}</span>
              <span style="color: var(--text);">
                {{ row.limit < 0 ? t('billing.usageUnlimited', { used: row.used }) : t('billing.usageOf', { used: row.used, limit: row.limit }) }}
              </span>
            </div>
            <div
              v-if="row.limit >= 0"
              class="mt-1 h-1.5 w-full overflow-hidden rounded-full"
              style="background: var(--surface-2);"
            >
              <!-- Recipe 9 (transitions.css): fill animates via transform only. -->
              <div
                class="usage-fill h-full w-full origin-left rounded-full"
                :style="{
                  transform: `scaleX(${row.frac})`,
                  background: row.frac >= 0.8 ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                }"
              />
            </div>
          </div>
        </div>

        <p v-if="billingLoading" class="mt-3 text-sm" style="color: var(--text-muted);">{{ t('common.loading') }}</p>

        <div v-else-if="billingError" class="mt-3">
          <p class="text-sm" style="color: var(--text-muted);">{{ t(billingError.key, billingError.params ?? {}) }}</p>
          <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="loadBillingConfig">
            {{ t('common.retry') }}
          </button>
        </div>

        <!-- Stripe not configured in this environment: notice only, no buttons. -->
        <p v-else-if="billingConfig && !billingConfig.enabled" class="mt-3 text-sm" style="color: var(--text-muted);">
          {{ t('billing.notConfigured') }}
        </p>

        <template v-else-if="billingConfig">
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt style="color: var(--text-muted);">{{ t('billing.currentPlan') }}</dt>
              <dd class="font-medium" style="color: var(--text);">{{ planLabel }}</dd>
            </div>
          </dl>

          <p v-if="auth.org?.subscriptionStatus === 'past_due'" class="mt-2 text-sm font-medium" style="color: var(--accent-amber);">
            {{ t('billing.statusPastDue') }}
          </p>
          <p v-else-if="auth.org?.subscriptionStatus === 'canceled'" class="mt-2 text-sm" style="color: var(--text-muted);">
            {{ t('billing.statusCanceled') }}
          </p>
          <p v-else-if="auth.org?.subscriptionStatus === 'active' && auth.org.currentPeriodEnd" class="mt-2 text-sm" style="color: var(--text-muted);">
            {{ t('billing.renewsOn', { date: d(auth.org.currentPeriodEnd, 'short') }) }}
          </p>

          <!-- Free plan: interval toggle + upgrade buttons (prices from config). -->
          <template v-if="!isPaidPlan">
            <div class="mt-4">
              <SegmentedControl
                v-model="interval"
                :options="[
                  { value: 'month', label: t('billing.intervalMonthly') },
                  { value: 'year', label: t('billing.intervalAnnual') },
                ]"
              />
            </div>
            <div class="mt-3 flex flex-wrap gap-3">
              <BaseButton :disabled="billingBusy" @click="upgrade('studio')">
                {{ t('billing.upgradeCta', { plan: t('billing.planStudio'), price: priceFor('studio') }) }}
              </BaseButton>
              <BaseButton :disabled="billingBusy" @click="upgrade('agency')">
                {{ t('billing.upgradeCta', { plan: t('billing.planAgency'), price: priceFor('agency') }) }}
              </BaseButton>
            </div>
            <p v-if="interval === 'year'" class="mt-2 text-xs" style="color: var(--text-muted);">{{ t('billing.billedAnnually') }}</p>
            <RouterLink
              to="/pricing"
              class="mt-2 inline-block text-xs underline-offset-2 hover:underline"
              style="color: var(--text-muted);"
            >
              {{ t('billing.seeAllPlans') }}
            </RouterLink>
          </template>

          <!-- Paid plan: upgrades/downgrades/cancellation live in the Stripe portal. -->
          <BaseButton v-else class="mt-4" :disabled="billingBusy" @click="openPortal">
            {{ t('billing.manage') }}
          </BaseButton>
        </template>
      </div>

      <!-- Leave workspace (non-owners only; the owner would 409 at the API) -->
      <div v-if="canLeave" class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.leaveTitle') }}</h2>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('settings.leaveHint') }}</p>
        <!-- Danger-muted: amber text on the page's flat surface, no filled CTA. -->
        <button
          type="button"
          :disabled="leaveBusy"
          class="mt-3 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style="background: var(--surface-2); color: var(--accent-amber); border-color: var(--border);"
          @click="showLeave = true"
        >
          {{ leaveBusy ? t('common.loading') : t('settings.leaveCta') }}
        </button>
      </div>

      <!-- Diagnostics: app → Cloud Function health check -->
      <div class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.health') }}</h2>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('settings.healthHint') }}</p>

        <p v-if="healthLoading" class="mt-3 text-sm" style="color: var(--text-muted);">{{ t('settings.healthChecking') }}</p>

        <p v-else-if="health?.ok" class="mt-3 text-sm font-medium" style="color: var(--accent-emerald);">
          {{ t('settings.healthOk') }} <span style="color: var(--text-muted);">({{ health.ts }})</span>
        </p>

        <div v-else class="mt-3">
          <p class="text-sm font-medium" style="color: var(--accent-amber);">{{ t('settings.healthFailed') }}</p>
          <p v-if="healthError" class="mt-1 text-xs" style="color: var(--text-muted);">{{ t(healthError.key, healthError.params ?? {}) }}</p>
          <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="checkHealth">
            {{ t('common.retry') }}
          </button>
        </div>
      </div>
    </div>

    <!-- auth.logout() resets the data store and redirects to /login itself. -->
    <BaseButton class="mt-6" @click="auth.logout()">{{ t('settings.signOut') }}</BaseButton>

    <ImportWizard v-if="has('import')" :open="showImport" @close="showImport = false" />

    <ConfirmDialog
      :open="showLeave"
      :title="t('settings.leaveTitle')"
      :message="t('settings.leaveConfirm', { org: auth.activeMembership?.orgName ?? '' })"
      danger
      :confirm-label="t('settings.leaveCta')"
      @confirm="confirmLeave"
      @cancel="showLeave = false"
    />
  </section>
</template>
