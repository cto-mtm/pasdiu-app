import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile as fbUpdateProfile,
  type User,
} from 'firebase/auth'
import {
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { auth, db } from '../lib/firebase'
import { acceptInviteApi, createOrgApi, declineInviteApi, fetchMyInvitesApi, renameOrgApi } from '../lib/api'
import type { PendingInvite } from '../lib/api'
import { identify, resetAnalytics, track } from '../lib/analytics'
import { mapMember, mapMembership, mapOrg, mapUsage } from '../lib/mappers'
import { i18n } from '../i18n'
import { router } from '../router'
import { useDataStore } from './data'
import type { Identity, Membership, Org, OrgUsage, Role, UserProfile } from '../lib/types'

const t = i18n.global.t

// Per-account persistence of the last active org, so a multi-org user lands
// back in the workspace they left.
function activeOrgKey(uid: string): string {
  return `pasdiu.activeOrg.${uid}`
}

function friendlyAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-email':
        return t('auth.errInvalid')
      case 'auth/email-already-in-use':
        return t('auth.errEmailInUse')
      case 'auth/too-many-requests':
        return t('auth.errThrottled')
      case 'auth/network-request-failed':
        return t('auth.errNetwork')
    }
  }
  return t('auth.errGeneric')
}

export const useAuthStore = defineStore('auth', () => {
  // Global identity (users/{uid}) — role-free; roles live per-membership.
  const identity = ref<Identity | null>(null)
  // Every org this account belongs to (collection-group query on `members`).
  const memberships = ref<Membership[]>([])
  // Which org the app is currently scoped to (persisted per uid).
  const activeOrgId = ref<string | null>(null)
  // Live orgs/{activeOrgId}/members/{uid} doc, so role/clientId changes in the
  // active org reflect without a re-login (same discipline as the old
  // users/{uid} profile listener).
  const liveMember = ref<UserProfile | null>(null)
  // Live orgs/{activeOrgId} doc — plan/limits/subscription state are written
  // by the billing webhook, so upgrades reflect here without a reload.
  const org = ref<Org | null>(null)
  // Live orgs/{activeOrgId}/usage/current doc — seat/client/task counters the
  // entitlement gates compare against the org's limits. null while loading
  // (gates fail open; rules are the backstop).
  const usage = ref<OrgUsage | null>(null)
  const error = ref<string | null>(null)

  // Full-page loader flag: true from the moment a login succeeds until the
  // landing page has loaded its initial data. Prevents the flash of an empty
  // app shell between login and first paint.
  const transitioning = ref(false)

  // Pending invites addressed to this account's email (checked at login).
  // Consumed by the welcome/onboarding page and by any in-app banner.
  const pendingInvites = ref<PendingInvite[]>([])

  const isAuthed = computed(() => identity.value !== null)

  const activeMembership = computed<Membership | null>(
    () => memberships.value.find((m) => m.orgId === activeOrgId.value) ?? null,
  )
  // The membership array entry serves as the fallback until the first live
  // snapshot of the member doc arrives (and right after an org switch).
  const role = computed<Role | null>(
    () => liveMember.value?.role ?? activeMembership.value?.role ?? null,
  )
  const isManager = computed(() => role.value === 'admin' || role.value === 'pm')
  const clientId = computed<string | undefined>(
    () => liveMember.value?.clientId ?? activeMembership.value?.clientId,
  )

  // Identity + the active org's clientId — the shape pages consume
  // (ClientPortalPage reads profile.clientId; everything else uses
  // uid/email/displayName).
  const profile = computed<(Identity & { clientId?: string }) | null>(() =>
    identity.value ? { ...identity.value, clientId: clientId.value } : null,
  )

  // Signed in but member of zero orgs: not an error anymore — it's the
  // onboarding state (create a workspace or accept an invite).
  const needsWorkspace = computed(() => isAuthed.value && memberships.value.length === 0)

  // ── Live member-doc subscription ────────────────────────────────
  let memberUnsub: (() => void) | null = null
  // Re-entrancy guard for error-driven revalidation: the error callback can
  // fire while a refreshMemberships kicked off by a previous error is still
  // in flight — never stack them.
  let memberErrorRevalidating = false
  function detachMember(): void {
    if (memberUnsub) { memberUnsub(); memberUnsub = null }
  }

  function subscribeMember(): void {
    detachMember()
    // Clear immediately so a previous org's role never leaks across a switch;
    // `role` falls back to the memberships entry for the new org meanwhile.
    liveMember.value = null
    const uid = identity.value?.uid
    const orgId = activeOrgId.value
    if (!uid || !orgId) return
    memberUnsub = onSnapshot(
      doc(db, 'orgs', orgId, 'members', uid),
      (snap) => {
        if (snap.exists()) {
          liveMember.value = mapMember(snap.id, snap.data())
        } else {
          // Removed from the active org: revalidate memberships, which picks
          // a new active org (or lands in onboarding).
          liveMember.value = null
          void refreshMemberships()
        }
      },
      () => {
        // Removal from the org arrives HERE, not as exists=false: rules
        // revoke the removed user's read on their own member doc, so
        // Firestore reports permission-denied. Revalidate memberships (picks
        // a new active org or lands in onboarding). The org/usage listeners
        // lose permission at the same moment but stay drop-only — this one
        // refresh is sufficient, and firing it from all three would just
        // storm the same query.
        liveMember.value = null
        if (memberErrorRevalidating) return
        memberErrorRevalidating = true
        refreshMemberships()
          .catch(() => {
            // Revalidation itself failed (rules/network): stop here with
            // liveMember null — the router guard sorts it out on the next
            // navigation.
          })
          .finally(() => { memberErrorRevalidating = false })
      },
    )
  }

  // ── Live org-doc subscription ───────────────────────────────────
  // Same lifecycle as the member doc: attach on activation/switch, detach on
  // logout. Members can read their org doc (rules), so this is safe per-role.
  let orgUnsub: (() => void) | null = null
  function detachOrg(): void {
    if (orgUnsub) { orgUnsub(); orgUnsub = null }
  }

  function subscribeOrg(): void {
    detachOrg()
    // Clear immediately so a previous org's plan never leaks across a switch.
    org.value = null
    const uid = identity.value?.uid
    const orgId = activeOrgId.value
    if (!uid || !orgId) return
    orgUnsub = onSnapshot(
      doc(db, 'orgs', orgId),
      (snap) => {
        org.value = snap.exists() ? mapOrg(snap.id, snap.data()) : null
      },
      // Permission loss (e.g. removed from the org) — the member listener
      // drives revalidation; here we just drop the stale doc.
      () => { org.value = null },
    )
  }

  // ── Live usage-doc subscription ─────────────────────────────────
  // orgs/{activeOrgId}/usage/current — same lifecycle as the org doc: attach
  // on activation/switch, detach on logout, clear before resubscribing so a
  // previous org's counters never leak across a switch.
  let usageUnsub: (() => void) | null = null
  function detachUsage(): void {
    if (usageUnsub) { usageUnsub(); usageUnsub = null }
  }

  function subscribeUsage(): void {
    detachUsage()
    usage.value = null
    const uid = identity.value?.uid
    const orgId = activeOrgId.value
    if (!uid || !orgId) return
    usageUnsub = onSnapshot(
      doc(db, 'orgs', orgId, 'usage', 'current'),
      (snap) => {
        usage.value = snap.exists() ? mapUsage(snap.data()) : null
      },
      // Permission loss — the member listener drives revalidation; just drop
      // the stale counters (gates fail open until the next snapshot).
      () => { usage.value = null },
    )
  }

  // ── Memberships ─────────────────────────────────────────────────
  async function refreshMemberships(): Promise<void> {
    const uid = identity.value?.uid
    if (!uid) return
    const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
    memberships.value = snap.docs.map((d) => mapMembership(d.data()))
    ensureActiveOrg()
  }

  // Validate/select the active org: keep the persisted choice when it's still
  // a membership, else fall back to the first membership (or none).
  function ensureActiveOrg(): void {
    const uid = identity.value?.uid
    if (!uid) return
    const stored = activeOrgId.value ?? localStorage.getItem(activeOrgKey(uid))
    const valid = stored !== null && memberships.value.some((m) => m.orgId === stored)
    const next = valid ? stored : memberships.value[0]?.orgId ?? null
    if (next === activeOrgId.value) return
    const hadOrg = activeOrgId.value !== null
    activeOrgId.value = next
    if (next) localStorage.setItem(activeOrgKey(uid), next)
    else localStorage.removeItem(activeOrgKey(uid))
    subscribeMember()
    subscribeOrg()
    subscribeUsage()
    if (hadOrg) {
      // The active org changed underneath us (e.g. removed from it) — same
      // clean-slate path as an explicit switch: no cross-org bleed.
      useDataStore().reset()
      void router.replace(next ? homeRoute() : { name: 'welcome' })
    }
  }

  // Explicit org switch (org switcher, post-create, post-accept). Always ends
  // at the role home of the target org.
  async function setActiveOrg(orgId: string): Promise<void> {
    const uid = identity.value?.uid
    if (!uid || !memberships.value.some((m) => m.orgId === orgId)) return
    if (orgId !== activeOrgId.value) {
      track('org_switched', { orgId })
      useDataStore().reset()
      activeOrgId.value = orgId
      localStorage.setItem(activeOrgKey(uid), orgId)
      subscribeMember()
      subscribeOrg()
      subscribeUsage()
    }
    await router.replace(homeRoute())
  }

  // ── Pending invitations ──────────────────────────────────────────
  // Read-only: joining a workspace is always the invitee's own act.
  //
  // This used to auto-accept every pending invite at bootstrap, on the grounds
  // that the manager had already authorized it so a second click bought
  // nothing. That reasoning conflates two different consents: the manager
  // authorizing means the WORKSPACE agrees to the user joining, which says
  // nothing about whether the USER agrees to join it. Obtaining that second
  // consent is the entire purpose of an invitation. In practice it meant
  // anyone who knew your address could put you in their workspace — with your
  // name and email on their team page — across several orgs in a single
  // sign-in, with no way to refuse.
  //
  // Failures are swallowed: an empty list is a legitimate state, and a user
  // with no invitations must still reach the create-a-workspace screen.
  async function loadPendingInvites(): Promise<void> {
    try {
      const res = await fetchMyInvitesApi()
      pendingInvites.value = res.ok ? res.data.invites : []
    } catch {
      pendingInvites.value = []
    }
  }

  // Refuse an invitation. Recorded server-side as 'declined' so the manager
  // can tell a refusal from an invite nobody has opened yet.
  async function declineInvite(orgId: string, inviteId: string): Promise<boolean> {
    error.value = null
    const res = await declineInviteApi(orgId, inviteId)
    if (!res.ok) {
      error.value = t(res.error.key, res.error.params ?? {})
      return false
    }
    track('invite_declined', { orgId })
    pendingInvites.value = pendingInvites.value.filter((i) => i.inviteId !== inviteId)
    return true
  }

  // ── Session bootstrap ───────────────────────────────────────────
  // Verified sign-in: record identity, upsert the global users/{uid} doc, then
  // load memberships and attach the active-org member listener. Zero
  // memberships is a valid state (→ onboarding), not a rejection.
  async function initSession(user: User): Promise<void> {
    const email = user.email ?? ''
    identity.value = {
      uid: user.uid,
      email,
      displayName: user.displayName ?? email,
    }
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { displayName: user.displayName ?? email, email, createdAt: serverTimestamp() },
        { merge: true },
      )
      await refreshMemberships()
      // Load (never accept) any invitations addressed to this account, and
      // only when the user has nowhere to land: /welcome renders them as the
      // primary way in, so it must not flash the create-a-workspace form
      // first.
      //
      // A user who already has a workspace is NOT fetched for here: their
      // invitations render in the app shell (components/PendingInvites.vue),
      // which loads them on mount. Fetching in both places would be the same
      // request twice on every sign-in.
      if (memberships.value.length === 0) {
        await loadPendingInvites()
      }
      // Analytics identity = uid only (never email/name — see lib/analytics).
      // Here rather than in the login functions so restored sessions count too.
      identify(user.uid)
    } catch {
      // Identity/membership load failed (rules, network): no half-session.
      await clearSession()
      error.value = t('auth.errGeneric')
      await fbSignOut(auth)
    }
  }

  async function clearSession(): Promise<void> {
    detachMember()
    detachOrg()
    detachUsage()
    identity.value = null
    memberships.value = []
    activeOrgId.value = null
    liveMember.value = null
    org.value = null
    usage.value = null
    pendingInvites.value = []
    // No cross-account bleed: gone means a clean data store.
    useDataStore().reset()
  }

  // Email verification gate: unverified accounts never get a session. We
  // (re)send the link and sign out; signing in again re-sends it, so no
  // separate "resend" flow is needed. `continueUrl` (an in-app path, e.g. an
  // invite link) becomes the verification email's continue destination so the
  // user lands back where they started instead of losing the flow.
  async function rejectUnverified(user: User, continueUrl?: string): Promise<void> {
    try {
      await sendEmailVerification(user, continueUrl ? { url: location.origin + continueUrl } : null)
    } catch {
      // Likely auth/too-many-requests from repeated attempts — the message
      // below still tells the user a link was sent, which remains true.
    }
    await clearSession()
    error.value = t('auth.verifyEmail')
    await fbSignOut(auth)
  }

  const ready = new Promise<void>((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user && !user.emailVerified) {
        // A persisted unverified session (shouldn't normally exist — login
        // rejects these): end it without re-sending mail to avoid spam loops.
        await fbSignOut(auth)
        resolve()
        return
      }
      if (user) {
        await initSession(user)
      } else {
        await clearSession()
      }
      resolve()
    })
  })

  // Shared post-credential path for every sign-in method: verification gate,
  // then session bootstrap (identity + memberships + member listener).
  async function completeSignIn(user: User): Promise<boolean> {
    if (!user.emailVerified) {
      await rejectUnverified(user)
      return false
    }
    await initSession(user)
    return identity.value !== null
  }

  async function login(email: string, password: string): Promise<boolean> {
    error.value = null
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const ok = await completeSignIn(cred.user)
      if (ok) {
        transitioning.value = true
        track('login', { method: 'password' })
      }
      return ok
    } catch (e) {
      error.value = friendlyAuthError(e)
      return false
    }
  }

  async function loginWithGoogle(): Promise<boolean> {
    error.value = null
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider())
      const ok = await completeSignIn(cred.user)
      if (ok) {
        transitioning.value = true
        track('login', { method: 'google' })
      }
      return ok
    } catch (e) {
      if (
        e instanceof FirebaseError &&
        (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')
      ) {
        return false // user dismissed the popup — not an error
      }
      error.value = friendlyAuthError(e)
      return false
    }
  }

  // Self-serve signup. Ends signed OUT behind the verification gate: the
  // account exists, the link is in their inbox, and signing in afterwards
  // walks the normal login path. Returns true when the account was created.
  async function signup(
    displayName: string,
    email: string,
    password: string,
    continueUrl?: string,
  ): Promise<boolean> {
    error.value = null
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await fbUpdateProfile(cred.user, { displayName })
      await rejectUnverified(cred.user, continueUrl) // sends the link + signs out + sets the message
      track('signup_completed')
      return true
    } catch (e) {
      error.value = friendlyAuthError(e)
      return false
    }
  }

  // ── Workspace creation / invites (HTTP API) ─────────────────────
  async function createOrg(name: string): Promise<boolean> {
    error.value = null
    const res = await createOrgApi(name)
    if (!res.ok) {
      error.value = t(res.error.key, res.error.params ?? {})
      return false
    }
    track('workspace_created', { orgId: res.data.orgId })
    await refreshMemberships()
    await setActiveOrg(res.data.orgId)
    return true
  }

  // Rename the active workspace (managers; enforced server-side). The API
  // fans the new name out to the denormalized member docs, so refresh the
  // memberships list (org switcher); the org doc itself updates via its live
  // subscription.
  async function renameOrg(name: string): Promise<boolean> {
    const orgId = activeOrgId.value
    if (!orgId) return false
    error.value = null
    const res = await renameOrgApi(orgId, name)
    if (!res.ok) {
      const codeMap: Record<string, string> = {
        invalid_name: 'common.invalidName',
        rename_cooldown: 'common.renameCooldown',
        org_not_found: 'common.orgNotFound',
      }
      const key = (res.error.code && codeMap[res.error.code]) || res.error.key
      error.value = t(key, res.error.params ?? {})
      return false
    }
    await refreshMemberships()
    return true
  }

  // Returns the API error code on failure (e.g. 'seat_limit' when the org has
  // no free seats) so InvitePage can render gate-specific states.
  async function acceptInvite(
    orgId: string,
    inviteId: string,
  ): Promise<{ ok: boolean; code?: string }> {
    error.value = null
    const res = await acceptInviteApi(orgId, inviteId)
    if (!res.ok) {
      error.value =
        res.error.code === 'seat_limit'
          ? t('invite.seatLimit')
          : t(res.error.key, res.error.params ?? {})
      return { ok: false, code: res.error.code }
    }
    track('invite_accepted', { orgId })
    await refreshMemberships()
    await setActiveOrg(orgId)
    return { ok: true }
  }

  // Always reports success for unknown emails (no account enumeration); only
  // real failures (network, throttling) surface as errors.
  async function resetPassword(email: string): Promise<boolean> {
    error.value = null
    try {
      await sendPasswordResetEmail(auth, email)
      return true
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'auth/user-not-found') return true
      error.value = friendlyAuthError(e)
      return false
    }
  }

  async function logout(): Promise<void> {
    track('logout')
    resetAnalytics()
    await fbSignOut(auth)
    await clearSession()
    await router.replace('/login')
  }

  function homeRoute(): string {
    switch (role.value) {
      case 'admin':
      case 'pm':
        return '/dashboard'
      case 'client':
        return '/portal'
      default:
        return '/slate'
    }
  }

  return {
    profile,
    error,
    ready,
    transitioning,
    isAuthed,
    role,
    isManager,
    clientId,
    memberships,
    activeOrgId,
    activeMembership,
    org,
    usage,
    needsWorkspace,
    pendingInvites,
    loadPendingInvites,
    declineInvite,
    refreshMemberships,
    setActiveOrg,
    login,
    loginWithGoogle,
    signup,
    createOrg,
    renameOrg,
    acceptInvite,
    resetPassword,
    logout,
    homeRoute,
  }
})
