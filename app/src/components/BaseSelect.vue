<script setup lang="ts">
// Standard form select: v-model plus the shared control styling. Options go
// in the default slot; native attrs (required, disabled…) pass through.
const model = defineModel<string>({ default: '' })
</script>

<template>
  <select
    v-model="model"
    class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
    style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
  >
    <slot />
  </select>
</template>
