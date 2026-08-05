<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BrandLogo from './BrandLogo.vue'

const { t } = useI18n()
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
    style="background: var(--bg);"
    role="status"
    :aria-label="t('common.loading')"
  >
    <BrandLogo class="h-16 w-16 animate-pulse-logo" />
    <p class="text-sm tracking-wide" style="color: var(--text-muted);">{{ t('common.loading') }}</p>
  </div>
</template>

<style scoped>
@keyframes pulse-logo {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.animate-pulse-logo {
  animation: pulse-logo 1.8s ease-in-out infinite;
}
</style>
