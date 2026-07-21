// Per-account, per-device "has seen the first-login tour" flag (same
// localStorage discipline as activeOrgKey in stores/auth.ts). Device-local on
// purpose: a returning user on a new device gets the tour once more.
function onboardingSeenKey(uid: string): string {
  return `pasdiu.onboardingSeen.${uid}`
}

export function hasSeenOnboarding(uid: string): boolean {
  return localStorage.getItem(onboardingSeenKey(uid)) === '1'
}

export function markOnboardingSeen(uid: string): void {
  localStorage.setItem(onboardingSeenKey(uid), '1')
}
