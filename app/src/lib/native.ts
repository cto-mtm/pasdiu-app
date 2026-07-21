import type { Router } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Wire up native-shell behavior. Called once from main.ts.
 *
 * Android back button: without this, the hardware/gesture back button closes
 * the whole app from ANY page instead of navigating back within the SPA. We
 * intercept it — if vue-router has history to go back to, go back; otherwise
 * exit the app (the expected behavior on the home screen).
 *
 * The entire registration is guarded by isNativePlatform(), so it's a no-op in
 * the browser.
 */
export function registerNative(router: Router): void {
  if (!Capacitor.isNativePlatform()) return

  App.addListener('backButton', () => {
    // window.history.state.back is set by vue-router when there's somewhere to go.
    if (window.history.state?.back) {
      router.back()
    } else {
      App.exitApp()
    }
  })
}

/**
 * Open an external URL (Stripe checkout/portal). In the browser a full-page
 * redirect is correct — checkout returns to /settings?billing=… on the same
 * origin. In the native shell that same redirect would navigate the WebView
 * itself away from the app with no way back, so open the system in-app
 * browser instead; when the user closes it, the app is untouched and the
 * live org snapshot reflects any webhook-driven plan change.
 */
export async function openExternal(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  } else {
    window.location.assign(url)
  }
}
