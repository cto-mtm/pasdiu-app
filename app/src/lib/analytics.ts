// Vendor-agnostic product analytics. The ONLY place posthog-js is touched —
// call sites import track()/identify()/resetAnalytics() and never the vendor.
//
// Dormant without a key (same stance as the Stripe billing layer): when
// VITE_POSTHOG_KEY is unset nothing loads and nothing is sent — in DEV each
// event logs via console.debug so the funnel stays visible in the emulator
// workflow. With a key, posthog-js is lazy-imported so it never weighs on
// the initial bundle; calls made while it loads are queued and flushed.
//
// PRIVACY (non-negotiable): event props must NEVER contain emails, display
// names, or any user-entered content — uids and org ids only. Identity
// resolution happens inside the analytics tool, not in the event stream.
import type { PostHog } from 'posthog-js'

// Every event the app may emit, in funnel order (BUSINESS_MODEL §7).
// Adding an event = adding it here first, so call sites stay typo-proof.
export type AnalyticsEvent =
  | 'page_view'
  // Acquisition / auth
  | 'signup_completed'
  | 'login'
  | 'logout'
  // Activation
  | 'workspace_created'
  | 'invite_accepted'
  | 'invite_created'
  | 'org_switched'
  | 'onboarding_viewed'
  | 'onboarding_completed'
  | 'onboarding_skipped'
  | 'client_created'
  | 'task_created'
  // Conversion funnel: gate → upsell → checkout
  | 'gate_hit'
  | 'upsell_viewed'
  | 'checkout_started'
  | 'checkout_completed'
  // Retention signals
  | 'workspace_left'

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined

// Set synchronously by initAnalytics() so events fired during the lazy
// import are queued instead of dropped.
let enabled = false
let client: PostHog | null = null
let queue: Array<(c: PostHog) => void> = []

/**
 * Call ONCE from main.ts, before the app mounts (and therefore before the
 * router's afterEach can fire the first page_view). No key → no-op forever.
 */
export function initAnalytics(): void {
  if (!KEY || enabled) return
  enabled = true
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
      // SPA: automatic pageviews only see the first load — the router's
      // afterEach fires page_view on every settled navigation instead.
      capture_pageview: false,
    })
    client = posthog
    for (const fn of queue) fn(client)
    queue = []
  })
}

// Run now if the vendor is loaded, else buffer until init resolves. When
// analytics is dormant the DEV console.debug happens at the call sites below.
function withClient(fn: (c: PostHog) => void): void {
  if (client) fn(client)
  else if (enabled) queue.push(fn)
}

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!enabled) {
    if (import.meta.env.DEV) console.debug('[analytics]', event, props)
    return
  }
  withClient((c) => c.capture(event, props))
}

/** Tie subsequent events to an account. uid only — never email/name. */
export function identify(uid: string): void {
  if (!enabled) {
    if (import.meta.env.DEV) console.debug('[analytics] identify', uid)
    return
  }
  withClient((c) => c.identify(uid))
}

/** Drop the identity + device state on logout (shared-machine hygiene). */
export function resetAnalytics(): void {
  if (!enabled) {
    if (import.meta.env.DEV) console.debug('[analytics] reset')
    return
  }
  withClient((c) => c.reset())
}
