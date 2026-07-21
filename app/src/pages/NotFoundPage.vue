<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <section class="py-12 text-center">
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('not-found.title') }}</h1>
    <p class="mt-2 text-sm" style="color: var(--text-muted);">{{ t('not-found.body') }}</p>
    <RouterLink to="/" class="mt-6 inline-block text-sm font-medium" style="color: var(--accent-cyan);">
      ← {{ t('not-found.home') }}
    </RouterLink>
  </section>
</template>
