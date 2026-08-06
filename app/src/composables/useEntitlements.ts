import { computed, type ComputedRef } from 'vue'
import { useAuthStore } from '../stores/auth'
import { PLAN_FEATURES, type PlanFeature } from '../lib/plans'
import type { OrgUsage, Plan } from '../lib/types'

// The gate that triggered an upsell — flows into UpsellModal and the
// /pricing deep link (?reason=…).
export type GateReason = 'clients' | 'tasks' | 'seats' | 'deliverables' | 'feature'

// Fail OPEN when either side is unknown (org/usage docs still loading):
// the UI never blocks on missing data — Firestore rules are the backstop
// that actually denies over-limit writes.
function underLimit(used: number | undefined, limit: number | undefined): boolean {
  if (used === undefined || limit === undefined) return true
  if (limit < 0) return true // -1 = unlimited
  return used < limit
}

/**
 * Entitlement gates as pure computeds over the auth store's live org +
 * usage subscriptions — NO Firestore access here. UI layer only: rules
 * enforce the same limits server-side, so every gate fails open while the
 * docs load.
 */
export function useEntitlements(): {
  plan: ComputedRef<Plan>
  limits: ComputedRef<{ seats: number; clients: number; tasks: number; deliverables: number } | null>
  usage: ComputedRef<OrgUsage | null>
  canCreateClient: ComputedRef<boolean>
  canCreateTask: ComputedRef<boolean>
  canCreateDeliverable: ComputedRef<boolean>
  canInvite: ComputedRef<boolean>
  has: (feature: PlanFeature) => boolean
} {
  const auth = useAuthStore()

  const plan = computed<Plan>(() => auth.org?.plan ?? 'free')

  const limits = computed(() =>
    auth.org
      ? { seats: auth.org.seatLimit, clients: auth.org.clientLimit, tasks: auth.org.taskLimit, deliverables: auth.org.deliverableLimit }
      : null,
  )

  const usage = computed<OrgUsage | null>(() => auth.usage)

  const canCreateClient = computed(() => underLimit(auth.usage?.activeClients, auth.org?.clientLimit))
  const canCreateTask = computed(() => underLimit(auth.usage?.activeTasks, auth.org?.taskLimit))
  const canCreateDeliverable = computed(() => underLimit(auth.usage?.activeDeliverables, auth.org?.deliverableLimit))
  const canInvite = computed(() => underLimit(auth.usage?.seats, auth.org?.seatLimit))

  // Feature flags by plan. Fails open while the org doc loads (null → true)
  // for the same reason as the counters: never block first paint on data
  // that arrives a beat later; the router + rules keep it honest.
  function has(feature: PlanFeature): boolean {
    return auth.org ? PLAN_FEATURES[auth.org.plan][feature] : true
  }

  return {
    plan,
    limits,
    usage,
    canCreateClient,
    canCreateTask,
    canCreateDeliverable,
    canInvite,
    has,
  }
}
