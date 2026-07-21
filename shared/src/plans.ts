import type { Plan } from './types.js'

// Single source of truth for plan entitlements and numeric limits.
// -1 means unlimited.
export const PLAN_LIMITS = {
  free: { seatLimit: 2, clientLimit: 3, taskLimit: 500 },
  studio: { seatLimit: 15, clientLimit: 25, taskLimit: 10000 },
  agency: { seatLimit: 50, clientLimit: -1, taskLimit: -1 },
} as const

export type PlanId = keyof typeof PLAN_LIMITS
export type PlanLimits = (typeof PLAN_LIMITS)[PlanId]

export const FREE_LIMITS = PLAN_LIMITS.free

/** Plans purchasable through Stripe (everything except free). */
export type PaidPlanId = Exclude<PlanId, 'free'>
export const PAID_PLANS: readonly PaidPlanId[] = ['studio', 'agency'] as const

// Display-only USD per-seat/month numbers for the pricing UI.
export const DISPLAY_PRICES = {
  studio: { priceMonthly: 12, priceAnnual: 10 },
  agency: { priceMonthly: 25, priceAnnual: 21 },
} as const satisfies Record<PaidPlanId, { priceMonthly: number; priceAnnual: number }>

export const PLAN_PRICING = DISPLAY_PRICES

// Display-only tier limits for pricing cards.
export const PLAN_DISPLAY_LIMITS: Record<
  Plan,
  { seats: number; clients: number; tasks: number }
> = {
  free: { seats: 2, clients: 3, tasks: 500 },
  studio: { seats: 15, clients: 25, tasks: 10000 },
  agency: { seats: 50, clients: -1, tasks: -1 },
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
