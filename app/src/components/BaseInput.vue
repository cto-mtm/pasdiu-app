<script setup lang="ts">
// Standard form text input: v-model plus the shared control styling. Native
// attrs (placeholder, type, required, disabled, autofocus…) pass through.
const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    v-model="model"
    class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
    style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
  />
</template>
