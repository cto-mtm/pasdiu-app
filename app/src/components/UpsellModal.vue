<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { track } from '../lib/analytics'
import type { GateReason } from '../composables/useEntitlements'
import Modal from './Modal.vue'
import BaseButton from './BaseButton.vue'

// Shown instead of a create modal when an entitlement gate blocks the action.
// Managers get the "See plans" CTA (→ /pricing with the gate pre-selected);
// everyone else is pointed at their workspace admin.
const props = defineProps<{ open: boolean; reason: GateReason }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

// Funnel instrumentation, single call site: every gate today opens this
// modal, so gate_hit === upsell_viewed for now. The names stay distinct so
// future pre-modal gating (e.g. a disabled create button that never opens
// the modal) can fire gate_hit alone without a schema migration.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    track('gate_hit', { gate: props.reason })
    track('upsell_viewed', { reason: props.reason })
  },
)

// The blocked gate's numeric limit, for the "{limit}-client limit" copy.
const limit = computed<number>(() => {
  const org = auth.org
  if (!org) return 0
  switch (props.reason) {
    case 'clients': return org.clientLimit
    case 'tasks': return org.taskLimit
    case 'seats': return org.seatLimit
    default: return 0
  }
})

const body = computed<string>(() => {
  switch (props.reason) {
    case 'clients': return t('billing.gateClients', { limit: limit.value })
    case 'tasks': return t('billing.gateTasks', { limit: limit.value })
    case 'seats': return t('billing.gateSeats', { limit: limit.value })
    default: return t('billing.gateFeature')
  }
})

function seePlans(): void {
  emit('close')
  void router.push({ path: '/pricing', query: { reason: props.reason } })
}
</script>

<template>
  <Modal :open="open" :title="t('billing.upsellTitle')" @close="emit('close')">
    <p class="text-sm" style="color: var(--text-muted);">{{ body }}</p>
    <p v-if="!auth.isManager" class="mt-2 text-sm" style="color: var(--text);">
      {{ t('billing.askAdmin') }}
    </p>
    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-sm"
        style="color: var(--text-muted);"
        @click="emit('close')"
      >
        {{ t('actions.cancel') }}
      </button>
      <BaseButton v-if="auth.isManager" @click="seePlans">{{ t('billing.seePlans') }}</BaseButton>
    </div>
  </Modal>
</template>
