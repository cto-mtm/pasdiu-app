<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useEntitlements } from '../composables/useEntitlements'
import OmniSearch from './OmniSearch.vue'
import BrandLogo from './BrandLogo.vue'
import BaseSelect from './BaseSelect.vue'
import PendingInvites from './PendingInvites.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { has } = useEntitlements()

// Open by default on desktop, closed (off-canvas) on mobile.
const open = ref(matchMedia('(min-width: 1024px)').matches)

// Simple icon set (Material-ish paths) keyed by section.
const ICONS: Record<string, string> = {
  dashboard: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  ledger: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h16v2H4v-2z',
  portal: 'M12 5C5 5 2 12 2 12s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z',
  slate: 'M20 6L9 17l-5-5',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  team: 'M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 10a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  analytics: 'M18 20V10M12 20V4M6 20v-6',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
}

const navItems = computed(() => {
  // /settings is open to every signed-in role.
  const shared = [{ to: '/settings', label: t('shell.navSettings'), icon: 'settings' }]
  if (auth.isManager) {
    // Analytics/Ledger are paid-plan features — hidden on Free (the router
    // redirects direct hits to Settings; rules protect the data itself).
    return [
      ...(has('analytics') ? [{ to: '/analytics', label: t('shell.navAnalytics'), icon: 'analytics' }] : []),
      { to: '/dashboard', label: t('shell.navDashboard'), icon: 'dashboard' },
      { to: '/all-tasks', label: t('shell.navAllTasks'), icon: 'tasks' },
      { to: '/team', label: t('shell.navTeam'), icon: 'team' },
      ...(has('ledger') ? [{ to: '/ledger', label: t('shell.navLedger'), icon: 'ledger' }] : []),
      ...shared,
    ]
  }
  if (auth.role === 'client') {
    return [{ to: '/portal', label: t('shell.navPortal'), icon: 'portal' }, ...shared]
  }
  return [{ to: '/slate', label: t('shell.navSlate'), icon: 'slate' }, ...shared]
})

// Org switcher: setActiveOrg resets the data store and routes home itself.
// Options are sorted (the collection-group query has no orderBy, so raw order
// can drift between sessions) and duplicate workspace names get the caller's
// role appended so two same-named agencies stay distinguishable.
const orgOptions = computed(() => {
  const sorted = [...auth.memberships].sort((a, b) => a.orgName.localeCompare(b.orgName))
  const nameCount = new Map<string, number>()
  for (const m of sorted) nameCount.set(m.orgName, (nameCount.get(m.orgName) ?? 0) + 1)
  return sorted.map((m) => ({
    orgId: m.orgId,
    label: (nameCount.get(m.orgName) ?? 0) > 1 ? `${m.orgName} · ${t('roles.' + m.role)}` : m.orgName,
  }))
})
function onOrgChange(orgId: string) {
  if (orgId && orgId !== auth.activeOrgId) void auth.setActiveOrg(orgId)
}

// auth.logout() resets the data store and redirects to /login itself.
async function logout() {
  await auth.logout()
}
function closeOnMobile() {
  if (!matchMedia('(min-width: 1024px)').matches) open.value = false
}

// Omni-search command palette (managers). ⌘K / Ctrl+K opens it.
const searchOpen = ref(false)
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && auth.isManager) {
    e.preventDefault()
    searchOpen.value = true
  }
}
// Invitations to OTHER workspaces. The store skips this fetch during bootstrap
// for accounts that already have a membership — it lands here instead, where
// something actually renders the result. The shell mounts once per signed-in
// session, so this is one request, not a per-navigation cost.
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void auth.loadPendingInvites()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <!-- Backdrop (mobile only) -->
    <div v-if="open" class="fixed inset-0 z-30 lg:hidden" style="background: rgba(0,0,0,0.5);" @click="open = false" />

    <!-- Sidebar -->
    <aside
      class="safe-top safe-bottom fixed inset-y-0 left-0 z-40 flex h-full shrink-0 flex-col border-r transition-transform duration-200 motion-reduce:transition-none lg:static lg:translate-x-0"
      :class="[open ? 'translate-x-0' : '-translate-x-full', open ? 'lg:w-60' : 'lg:w-16']"
      style="background: var(--surface); border-color: var(--border);"
    >
      <!-- Brand -->
      <div class="flex items-center gap-2 px-4 py-4">
        <BrandLogo class="h-8 w-8 shrink-0" />
        <span v-if="open" class="font-display text-lg tracking-tight" style="color: var(--text);">{{ t('common.appName') }}</span>
      </div>

      <!-- Workspace: switcher for multi-org accounts, a static label otherwise
           (users should always know which workspace they're in). -->
      <div v-if="open && auth.memberships.length" class="px-4 pb-3">
        <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('shell.workspaceLabel') }}</span>
        <BaseSelect
          v-if="auth.memberships.length > 1"
          :model-value="auth.activeOrgId ?? ''"
          :aria-label="t('shell.workspaceLabel')"
          @update:model-value="onOrgChange"
        >
          <option v-for="o in orgOptions" :key="o.orgId" :value="o.orgId">{{ o.label }}</option>
        </BaseSelect>
        <p v-else class="truncate text-sm font-medium" style="color: var(--text);">{{ auth.activeMembership?.orgName }}</p>
      </div>

      <!-- Collapsed rail: the workspace must stay identifiable — an initial
           badge (full name in the tooltip) that expands the sidebar to switch. -->
      <div v-else-if="auth.activeMembership" class="flex justify-center pb-3">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold transition-colors"
          style="background: var(--surface-2); color: var(--accent-cyan);"
          :title="auth.activeMembership.orgName"
          :aria-label="`${t('shell.workspaceLabel')}: ${auth.activeMembership.orgName}`"
          @click="open = true"
        >
          {{ auth.activeMembership.orgName.slice(0, 1).toUpperCase() }}
        </button>
      </div>

      <!-- Workspaces inviting you, directly under the ones you're already in.
           Capped and scrollable: invitations must never push the nav out of
           reach, however many are waiting. -->
      <div v-if="open && auth.pendingInvites.length" class="max-h-64 overflow-y-auto px-4 pb-3">
        <PendingInvites />
      </div>

      <!-- Collapsed rail: a count badge that expands the sidebar to act on
           them (same affordance as the workspace initial above). -->
      <div v-else-if="auth.pendingInvites.length" class="flex justify-center pb-3">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold transition-colors"
          style="background: var(--surface-2); color: var(--accent-amber);"
          :title="t('shell.invitations')"
          :aria-label="t('shell.invitationsAria', { count: auth.pendingInvites.length })"
          @click="open = true"
        >
          {{ auth.pendingInvites.length }}
        </button>
      </div>

      <!-- Sections -->
      <nav class="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          active-class="is-active"
          style="color: var(--text-muted);"
          :title="item.label"
          @click="closeOnMobile"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICONS[item.icon]" />
          </svg>
          <span v-if="open">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- Footer: user + logout (language lives in Settings) -->
      <div class="border-t px-3 py-3" style="border-color: var(--border);">
        <div class="flex items-center justify-between gap-2">
          <div v-if="open" class="min-w-0">
            <p class="truncate text-sm" style="color: var(--text);">{{ auth.profile?.displayName || t('common.userFallback') }}</p>
            <p class="truncate text-xs" style="color: var(--text-muted);">{{ t('roles.' + (auth.role ?? 'contractor')) }}</p>
          </div>
          <button
            class="shrink-0 rounded-lg p-2 transition-colors"
            style="color: var(--accent-cyan);"
            :title="t('auth.signOut')"
            :aria-label="t('auth.signOut')"
            @click="logout"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main column -->
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      <!-- Slim top strip: toggle + search. Inner container matches <main> so the
           header and page content share one gutter/max-width (spacing lives here,
           not in each page). -->
      <header
        class="safe-top sticky top-0 z-20 border-b backdrop-blur"
        style="background: color-mix(in srgb, var(--bg) 85%, transparent); border-color: var(--border);"
      >
        <div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <button
            class="rounded-lg p-2 transition-colors"
            style="color: var(--text);"
            :aria-label="t('shell.toggleNav')"
            @click="open = !open"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <button
            v-if="auth.isManager"
            class="flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors"
            style="background: var(--surface-2); color: var(--text-muted); border-color: var(--border);"
            :aria-label="t('search.open')"
            @click="searchOpen = true"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <kbd class="hidden text-xs sm:inline">⌘K</kbd>
          </button>
        </div>
      </header>

      <OmniSearch :open="searchOpen" @close="searchOpen = false" />

      <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.is-active {
  color: var(--accent-cyan) !important;
  background: color-mix(in srgb, var(--accent-cyan) 12%, transparent);
}
</style>
