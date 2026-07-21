<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES, type Locale } from '../i18n'

const { locale, t } = useI18n()

function set(l: Locale) {
  locale.value = l
}
</script>

<template>
  <div class="flex items-center gap-1" :aria-label="t('shell.localeLabel')" role="group">
    <button
      v-for="l in SUPPORTED_LOCALES"
      :key="l"
      class="rounded px-2 py-1 text-xs font-semibold uppercase transition-colors"
      :style="{
        color: locale === l ? 'var(--bg)' : 'var(--text-muted)',
        background: locale === l ? 'var(--accent-cyan)' : 'transparent',
      }"
      :aria-pressed="locale === l"
      @click="set(l)"
    >
      {{ l }}
    </button>
  </div>
</template>
