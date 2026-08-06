import { nextTick } from 'vue'
import { createRouter, createWebHistory, START_LOCATION, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { PLAN_FEATURES, type PlanFeature } from '../lib/plans'
import { track } from '../lib/analytics'
import type { Role } from '../lib/types'

// ── Route meta type augmentation ────────────────────────────────
declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    roles?: Role[]
    feature?: PlanFeature
  }
}

// Routes that are ALWAYS reachable regardless of auth state or workspace
// membership — extracted so the guard doesn't repeat the check in two places.
const ALWAYS_REACHABLE = new Set(['invite', 'pricing'])

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
  { path: '/', name: 'root', component: () => import('../pages/LoginPage.vue') },

  // Manager (admin/pm) surfaces
  { path: '/dashboard', name: 'dashboard', component: () => import('../pages/DashboardPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/clients/:clientId', name: 'client', component: () => import('../pages/ClientDetailPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/queue', name: 'queue', component: () => import('../pages/AllTasksPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/team', name: 'team', component: () => import('../pages/TeamPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/team/:uid', name: 'team-member', component: () => import('../pages/TeamMemberPage.vue'), meta: { roles: ['admin', 'pm'] } },
  { path: '/analytics', name: 'analytics', component: () => import('../pages/AnalyticsPage.vue'), meta: { roles: ['admin', 'pm'], feature: 'analytics' } },
  { path: '/ledger', name: 'ledger', component: () => import('../pages/LedgerPage.vue'), meta: { roles: ['admin', 'pm'], feature: 'ledger' } },

  // Available to every signed-in role.
  { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },

  // Boards + task views (managers + contractors)
  { path: '/projects/:projectId', name: 'project', component: () => import('../pages/ProjectBoardPage.vue'), meta: { roles: ['admin', 'pm', 'contractor'] } },
  { path: '/deliverables/:deliverableId', name: 'deliverable', component: () => import('../pages/DeliverableDetailPage.vue'), meta: { roles: ['admin', 'pm', 'contractor'] } },
  { path: '/calendar', name: 'calendar', component: () => import('../pages/CalendarPage.vue'), meta: { roles: ['admin', 'pm', 'contractor'] } },
  { path: '/schedule', name: 'schedule', component: () => import('../pages/SchedulePage.vue'), meta: { roles: ['admin', 'pm', 'contractor'] } },
  { path: '/tasks/:taskId', name: 'task', component: () => import('../pages/IterationRoomPage.vue'), meta: { roles: ['admin', 'pm', 'contractor', 'client'] } },

  // Contractor + client surfaces
  { path: '/slate', name: 'slate', component: () => import('../pages/SlatePage.vue'), meta: { roles: ['contractor'] } },
  { path: '/portal', name: 'portal', component: () => import('../pages/ClientPortalPage.vue'), meta: { roles: ['client'] } },
  { path: '/portal/:deliverableId', name: 'portal-deliverable', component: () => import('../pages/PortalDeliverablePage.vue'), meta: { roles: ['client'] } },

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

  // Zero memberships: everything funnels into onboarding. Invite and pricing
  // stay reachable.
  if (auth.needsWorkspace && to.name !== 'welcome' && !ALWAYS_REACHABLE.has(to.name as string)) {
    return { name: 'welcome' }
  }

  // With a workspace, the onboarding screen is pointless — go home.
  if (!auth.needsWorkspace && to.name === 'welcome') {
    return auth.homeRoute()
  }

  // Signed-in users skip public routes (login) and land on their role home —
  // except always-reachable routes.
  if ((to.meta.public && !ALWAYS_REACHABLE.has(to.name as string)) || to.name === 'root') {
    return auth.homeRoute()
  }

  // Role gating.
  if (to.meta.roles && auth.role && !to.meta.roles.includes(auth.role)) {
    return auth.homeRoute()
  }

  // Plan gating (meta.feature): paid-plan surfaces redirect Free workspaces
  // to Settings. Null org ALLOWS — never block first paint on billing data.
  if (to.meta.feature && auth.org && !PLAN_FEATURES[auth.org.plan][to.meta.feature]) {
    return { name: 'settings' }
  }
  return true
})

// ── ANALYTICS ───────────────────────────────────────────────────
router.afterEach((to) => {
  track('page_view', { name: to.name })
})

// ── VIEW TRANSITION WRAPPER ─────────────────────────────────────
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
