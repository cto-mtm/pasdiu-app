// The ONLY place VITE_API_URL is read. Everything else calls apiFetch().
//
// Fallbacks:
//  - dev  → the Firebase Emulator under the offline `demo-app` project id, so
//           `npm run dev` works even if you forgot to `cp .env.example .env`.
//  - prod → the deployed Cloud Function (REPLACE_ME project id).
import { auth } from './firebase'
import type { BillingConfig, BillingInterval, Plan, Role } from './types'

const DEV_FALLBACK = 'http://127.0.0.1:5001/demo-app/us-east5/api'
const PROD_FALLBACK = 'https://us-east5-REPLACE_ME.cloudfunctions.net/api'

const BASE_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? DEV_FALLBACK : PROD_FALLBACK)

// Structured, translatable error: callers render it with t(key, params).
// `code` is the API's machine-readable error id (e.g. 'seat_limit' from a
// 409 on invite-accept) for callers that branch on specific failures.
export interface ApiError {
  key: string
  params?: Record<string, unknown>
  code?: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/**
 * Typed fetch wrapper for the Cloud Function. JSON in / JSON out. Throws
 * nothing — every failure (network, non-2xx, bad JSON) surfaces in the return
 * value so callers can handle it without try/catch. Errors carry i18n keys,
 * never hardcoded copy.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const url = BASE_URL + path
  try {
    // Authenticated routes (/orgs/**) require a Firebase ID token; attach it
    // whenever someone is signed in so callers never handle auth themselves.
    const token = await auth.currentUser?.getIdToken()
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    })

    const text = await res.text()
    const body = text ? JSON.parse(text) : null

    if (!res.ok) {
      // API errors ship as { error: '<code>' } — surface the code so callers
      // can branch (the message stays a translatable key, never server copy).
      const code =
        body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? ((body as { error: string }).error)
          : undefined
      return { ok: false, error: { key: 'common.apiErrorRequest', params: { status: res.status }, code } }
    }

    return { ok: true, data: body as T }
  } catch {
    return { ok: false, error: { key: 'common.apiErrorNetwork' } }
  }
}

// ── Org endpoints (Cloud Functions HTTP API) ────────────────────
// Thin typed wrappers — all failure handling stays in apiFetch's ApiResult.

export interface InviteInfo {
  orgName: string
  role: Role
  email: string
}

export function createOrgApi(name: string): Promise<ApiResult<{ orgId: string }>> {
  return apiFetch<{ orgId: string }>('/orgs', { method: 'POST', body: JSON.stringify({ name }) })
}

export function fetchInviteApi(orgId: string, inviteId: string): Promise<ApiResult<InviteInfo>> {
  return apiFetch<InviteInfo>(`/orgs/${orgId}/invites/${inviteId}`)
}

export function acceptInviteApi(orgId: string, inviteId: string): Promise<ApiResult<{ orgId: string }>> {
  return apiFetch<{ orgId: string }>(`/orgs/${orgId}/invites/${inviteId}/accept`, { method: 'POST' })
}

export function removeMemberApi(orgId: string, uid: string): Promise<ApiResult<null>> {
  return apiFetch<null>(`/orgs/${orgId}/members/${uid}`, { method: 'DELETE' })
}

// ── Billing endpoints (Stripe via Cloud Functions) ──────────────
// Checkout/portal return a Stripe-hosted URL; callers open it via
// openExternal() in lib/native.ts (full-page redirect on the web, system
// in-app browser in the native shell). Checkout lands back on
// /settings?billing=success|cancelled.

export function getBillingConfigApi(): Promise<ApiResult<BillingConfig>> {
  return apiFetch<BillingConfig>('/billing/config')
}

export function createCheckoutApi(
  orgId: string,
  plan: Exclude<Plan, 'free'>,
  interval: BillingInterval,
): Promise<ApiResult<{ url: string }>> {
  return apiFetch<{ url: string }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ orgId, plan, interval }),
  })
}

export function createPortalApi(orgId: string): Promise<ApiResult<{ url: string }>> {
  return apiFetch<{ url: string }>('/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ orgId }),
  })
}
