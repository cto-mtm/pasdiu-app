<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { PLAN_FEATURES, type PlanFeature } from './lib/plans'
import type { Role } from './lib/types'
import AppShell from './components/AppShell.vue'
import FullPageLoader from './components/FullPageLoader.vue'
import OnboardingTour from './components/OnboardingTour.vue'
import Toaster from './components/Toaster.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// The chrome (header + nav) only shows for signed-in users on app routes —
// login, onboarding, and invite acceptance render chrome-less.
const BARE_ROUTES = ['login', 'welcome', 'invite', 'pricing']
const chrome = computed(() => auth.isAuthed && !BARE_ROUTES.includes(String(route.name)))

// Safety-net: if a page fails to clear `transitioning` (uncaught error, edge
// case), auto-dismiss after 5 s so the user is never permanently stuck.
watch(
  () => auth.transitioning,
  (active) => {
    if (active) {
      const timer = setTimeout(() => { auth.transitioning = false }, 5000)
      const stop = watch(() => auth.transitioning, (v) => {
        if (!v) { clearTimeout(timer); stop() }
      })
    }
  },
)

// The router guard only checks meta.roles on navigation. The profile doc is a
// live subscription, so a role change (e.g. an admin demoting this user) can
// land while they sit on a page their new role may no longer see — eject them
// to their role home. (Sign-out sets role to null; logout() handles that.)
watch(
  () => auth.role,
  (role) => {
    const allowed = route.meta.roles as Role[] | undefined
    if (role && allowed && !allowed.includes(role)) {
      void router.replace(auth.homeRoute())
    }
  },
)

// Same live-data problem for meta.feature: the router guard ALLOWS while the
// org doc is still null (never block first paint on billing data), and the
// plan can change underneath us via the billing webhook. Re-run the guard's
// feature check for the current route whenever the org doc arrives/changes,
// ejecting to Settings (the plan/upgrade page) — mirrors router/index.ts.
watch(
  () => auth.org,
  (org) => {
    const feature = route.meta.feature as PlanFeature | undefined
    if (feature && org && !PLAN_FEATURES[org.plan][feature]) {
      void router.replace({ name: 'settings' })
    }
  },
)
</script>

<template>
  <!-- Full-page loader: shown during initial auth check (hard refresh on a
       deep URL) or during the post-login transition until data arrives. -->
  <FullPageLoader v-if="!auth.initialized || auth.transitioning" />

  <!-- The chrome'd RouterView is keyed on the active org so switching orgs
       remounts the page even when the route itself doesn't change (otherwise
       a same-route switch renders the freshly-reset data store as a fake-empty
       workspace). Bare routes (login/welcome/invite/pricing) stay unkeyed. -->
  <AppShell v-else-if="chrome">
    <RouterView :key="auth.activeOrgId ?? 'none'" />
  </AppShell>
  <RouterView v-else />
  <!-- First-login tour: chrome-only, so the /welcome funnel and other bare
       routes never see it; it opens once the user lands in a workspace. -->
  <OnboardingTour v-if="chrome && auth.initialized && !auth.transitioning" />
  <Toaster />
</template>
