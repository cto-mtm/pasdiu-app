import { nextTick } from 'vue'
import { createRouter, createWebHistory, START_LOCATION, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { PLAN_FEATURES, type PlanFeature } from '../lib/plans'
import { track } from '../lib/analytics'
import type { Role } from '../lib/types'

// meta.roles: if present, only those roles may enter. meta.public: no auth.
// meta.feature: if present, the active org's plan must include it (see guard).
const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { public: true } },
  // Public pricing page: reachable signed-out (marketing/upsell) AND signed-in
  // (upgrade CTAs) — exempt from the signed-in public-route redirect below.
  { path: '/pricing', name: 'pricing', component: () => import('../pages/PricingPage.vue'), meta: { public: true } },

  // Onboarding: signed-in accounts with zero org memberships land here to
  // create a workspace (no meta.roles — there is no role without an org).
  { path: '/welcome', name: 'welcome', component: () => import('../pages/OnboardingPage.vue') },
  // Invite acceptance: public so the link can be opened signed-out (→ signup),
  // and explicitly exempt from the signed-in public-route redirect below.
  { path: '/invite/:orgId/:inviteId', name: 'invite', component: () => import('../pages/InvitePage.vue'), meta: { public: true } },

  // Role landing is resolved by the guard; '/' just triggers the redirect.
  { path: '/', name: 'root', redirect: () => ({ name: 'login' }) },

  // Manager (admin/pm) surfaces
  { path: '/dashboard', name: 'dashboard', component: () => import('../pages/DashboardPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/clients/:clientId', name: 'client', component: () => import('../pages/ClientDetailPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/all-tasks', name: 'all-tasks', component: () => import('../pages/AllTasksPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/team', name: 'team', component: () => import('../pages/TeamPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/team/:uid', name: 'team-member', component: () => import('../pages/TeamMemberPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/analytics', name: 'analytics', component: () => import('../pages/AnalyticsPage.vue'), meta: { roles: ['admin', 'pm'], feature: 'analytics' } },
  { path: '/ledger', name: 'ledger', component: () => import('../pages/LedgerPage.vue'), meta: { roles: ['admin', 'pm'], feature: 'ledger' } },

  // Available to every signed-in role (includes the app→Cloud Function
  // health-check diagnostics).
  { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },

  // Boards + task views (managers + contractors)
  { path: '/projects/:projectId', name: 'project', component: () => import('../pages/ProjectBoardPage.vue'), meta: { roles: ['admin', 'pm', 'contractor'] } },
  { path: '/tasks/:taskId', name: 'task', component: () => import('../pages/IterationRoomPage.vue'), meta: { roles: ['admin', 'pm', 'contractor', 'client'] } },

  // Contractor + client surfaces
  { path: '/slate', name: 'slate', component: () => import('../pages/SlatePage.vue'), meta: { roles: ['contractor'] } },
  { path: '/portal', name: 'portal', component: () => import('../pages/ClientPortalPage.vue'), meta: { roles: ['client'] } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../pages/NotFoundPage.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// ── AUTH + ROLE GUARD ───────────────────────────────────────────
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.ready // wait for the initial Firebase auth state + profile

  // Signed-out users may only see public routes.
  if (!auth.isAuthed) {
    return to.meta.public ? true : { name: 'login' }
  }

  // Zero memberships: everything funnels into onboarding. The invite screen
  // stays reachable — accepting one is how a first workspace can appear —
  // and so is pricing (it doubles as the upgrade/marketing page).
  if (auth.needsWorkspace && to.name !== 'welcome' && to.name !== 'invite' && to.name !== 'pricing') {
    return { name: 'welcome' }
  }

  // With a workspace, the onboarding screen is pointless — go home.
  if (!auth.needsWorkspace && to.name === 'welcome') {
    return auth.homeRoute()
  }

  // Signed-in users skip public routes (login) and land on their role home —
  // except the invite screen (doubles as the signed-in accept flow) and the
  // pricing page (doubles as the signed-in upgrade page).
  if ((to.meta.public && to.name !== 'invite' && to.name !== 'pricing') || to.name === 'root') {
    return auth.homeRoute()
  }

  // Role gating.
  const allowed = to.meta.roles as Role[] | undefined
  if (allowed && auth.role && !allowed.includes(auth.role)) {
    return auth.homeRoute()
  }

  // Plan gating (meta.feature): paid-plan surfaces redirect Free workspaces
  // to Settings (their plan/upgrade page). The org doc loads async after
  // navigation, so a null org ALLOWS — never block first paint on billing
  // data; the nav hides these entries and rules protect the data anyway.
  const feature = to.meta.feature as PlanFeature | undefined
  if (feature && auth.org && !PLAN_FEATURES[auth.org.plan][feature]) {
    return { name: 'settings' }
  }
  return true
})

// ── ANALYTICS ───────────────────────────────────────────────────
// page_view on every settled navigation (posthog's automatic pageview is off:
// it only sees full loads, not SPA routes). Safe ordering: initAnalytics()
// runs in main.ts before app.mount(), and the first navigation only settles
// during mount — so this can never fire before init. Route NAME only, never
// the path/params (a path like /invite/:orgId/:inviteId leaks ids into a
// third party; the name doesn't).
router.afterEach((to) => {
  track('page_view', { name: to.name })
})

// ── VIEW TRANSITION WRAPPER ─────────────────────────────────────
// Every navigation becomes a view transition when supported. Pages opt into
// effects purely via CSS in assets/css/transitions.css. NEVER call
// document.startViewTransition anywhere else.
router.beforeResolve((_to, from) => {
  if (from === START_LOCATION) return
  if (!document.startViewTransition) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

  return new Promise<void>((resolve) => {
    document.startViewTransition(() => {
      resolve()
      return nextTick()
    })
  })
})
