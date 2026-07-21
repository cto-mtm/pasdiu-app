import { onMounted, onUnmounted, watch, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Page-scoped document title: "<title> · <app name>" while the component is
 * mounted, back to the bare app name on unmount. Pass a computed built from
 * t() so locale switches retitle live. Deliberately opt-in per page (pricing,
 * login, settings for now) rather than a router-wide meta — rolling it out
 * everywhere is a follow-up.
 */
export function useDocumentTitle(title: Ref<string> | ComputedRef<string>): void {
  const { t } = useI18n()

  function apply(): void {
    document.title = `${title.value} · ${t('common.appName')}`
  }

  watch(title, apply)
  onMounted(apply)
  onUnmounted(() => {
    document.title = t('common.appName')
  })
}
