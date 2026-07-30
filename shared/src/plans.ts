import type { Plan } from './types.js'

// Single source of truth for plan entitlements and numeric limits.
// -1 means unlimited.
export const PLAN_LIMITS = {
  free: { seatLimit: 3, clientLimit: 3, taskLimit: 500, deliverableLimit: 50 },
  studio: { seatLimit: 20, clientLimit: -1, taskLimit: 10000, deliverableLimit: 2000 },
  agency: { seatLimit: -1, clientLimit: -1, taskLimit: -1, deliverableLimit: -1 },
} as const

export type PlanId = keyof typeof PLAN_LIMITS
export type PlanLimits = (typeof PLAN_LIMITS)[PlanId]

export const FREE_LIMITS = PLAN_LIMITS.free

/** Plans purchasable through Stripe (everything except free). */
export type PaidPlanId = Exclude<PlanId, 'free'>
export const PAID_PLANS: readonly PaidPlanId[] = ['studio', 'agency'] as const

// Display-only USD numbers for the pricing UI. FLAT per workspace — not per
// seat: a plan buys a seat allowance (PLAN_LIMITS.seatLimit), and every seat
// inside it costs the same nothing. `priceAnnualTotal` is the whole-year
// charge, deliberately 10 × monthly ("2 months free", ~16.7% off).
export const DISPLAY_PRICES = {
  studio: { priceMonthly: 49, priceAnnualTotal: 490 },
  agency: { priceMonthly: 149, priceAnnualTotal: 1490 },
} as const satisfies Record<PaidPlanId, { priceMonthly: number; priceAnnualTotal: number }>

export const PLAN_PRICING = DISPLAY_PRICES

// Display-only tier limits for pricing cards.
export const PLAN_DISPLAY_LIMITS: Record<
  Plan,
  { seats: number; clients: number; tasks: number; deliverables: number }
> = {
  free: { seats: 3, clients: 3, tasks: 500, deliverables: 50 },
  studio: { seats: 20, clients: -1, tasks: 10000, deliverables: 2000 },
  agency: { seats: -1, clients: -1, tasks: -1, deliverables: -1 },
}

// Plan → feature-flag table for UI feature gating.
export interface PlanFeatures {
  ledger: boolean
  analytics: boolean
  import: boolean
  csvExport: boolean
}

export type PlanFeature = keyof PlanFeatures

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: { ledger: false, analytics: false, import: false, csvExport: false },
  studio: { ledger: true, analytics: true, import: true, csvExport: true },
  agency: { ledger: true, analytics: true, import: true, csvExport: true },
}

export const SALES_MAILTO = 'mailto:sales@example.com'
