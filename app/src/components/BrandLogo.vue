<script setup lang="ts">
// The Pasdiu logo mark (white, for the cinematic dark theme). Imported so
// Vite emits correctly-based URLs that also work inside the Capacitor native
// shell. (assets/logo-black.svg stays on disk as a brand asset for print/light
// contexts, but nothing in the app renders it.)
import { useI18n } from 'vue-i18n'
import logoWhite from '../assets/logo-white.svg'

const { t } = useI18n()
</script>

<template>
  <img
    :src="logoWhite"
    :alt="t('common.appName')"
    class="block object-contain"
    draggable="false"
  />
</template>
