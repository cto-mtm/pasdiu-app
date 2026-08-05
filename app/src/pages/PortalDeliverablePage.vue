<script setup lang="ts">
// PortalDeliverablePage — the client's view of one deliverable: stage
// progress, the latest cut, version history, the feedback thread, and the
// approve / request-changes actions.
//
// This is deliberately NOT the manager DeliverableDetailPage with role
// branches: that page's reads (org-wide clients listener, unfiltered task
// query) are illegal for the client role — Firestore rejects them wholesale —
// and its affordances (edit, brief drawer) are manager-only. Everything here
// is rule-safe for clients:
//  - the deliverable doc itself (clientId + clientVisible gated get)
//  - stageSummary on the doc — stage states with ZERO task reads (this is
//    exactly what the trigger-maintained projection exists for; its
//    taskId/clientVisible fields are also what links stage chips into the
//    Iteration Room without a task query)
//  - versions/notes subcollections (hasDeliverableAccess)
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { apiFetch } from '../lib/api'
import { mapDeliverable, mapNote, mapVersion } from '../lib/mappers'
import { isDoneStatus, statusColor } from '../lib/status'
import type { Deliverable, Note, Version } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import PriorityBadge from '../components/PriorityBadge.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'

const { t, d } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const data = useDataStore()
const toast = useToastStore()
const { busy, run } = useBusy()

const deliverableId = computed(() => String(route.params.deliverableId))
const deliverable = ref<Deliverable | null>(null)
const versions = ref<Version[]>([])
const notes = ref<Note[]>([])
const loadError = ref(false)
const loaded = ref(false)

async function load() {
  loadError.value = false
  try {
    const orgId = auth.activeOrgId
    const cid = auth.clientId
    const uid = auth.profile?.uid
    if (!orgId || !cid || !uid) return

    const snap = await getDoc(doc(db, 'deliverables', deliverableId.value))
    if (!snap.exists()) {
      loaded.value = true
      return
    }
    const del = mapDeliverable(snap.id, snap.data())
    // Tenancy paranoia on a deep link: the rules already deny foreign reads,
    // but never render a doc that isn't this client's own visible work.
    if (del.orgId !== orgId || del.clientId !== cid || !del.clientVisible) {
      loaded.value = true
      return
    }
    deliverable.value = del

    // Note-author names come from the member roster (readable by every org
    // member, clients included).
    await data.loadUsers()

    const [vSnap, nSnap] = await Promise.all([
      getDocs(collection(db, 'deliverables', deliverableId.value, 'versions')),
      getDocs(collection(db, 'deliverables', deliverableId.value, 'notes')),
    ])
    versions.value = vSnap.docs
      .map((x) => mapVersion(x.id, x.data()))
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    notes.value = nSnap.docs
      .map((x) => mapNote(x.id, x.data()))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)

// Stage progress straight from the trigger-maintained summary — the tasks
// are the authority, but the summary is the read cache built for exactly
// this surface. Current stage = first non-terminal entry.
const stages = computed(() => deliverable.value?.stageSummary ?? [])
const currentIndex = computed(() => stages.value.findIndex((s) => !isDoneStatus(s.status)))
const complete = computed(() => stages.value.length > 0 && currentIndex.value === -1)

// A stage chip links into the Iteration Room when its task is shared with the
// client (the task route admits clients). The summary carries the task's id
// and visibility, so no task query is needed.
const linkedTaskId = (s: (typeof stages.value)[number]) => (s.clientVisible ? s.taskId : '')

// ── Feedback thread ─────────────────────────────────────────────
const noteBody = ref('')
async function sendNote() {
  const body = noteBody.value.trim()
  const uid = auth.profile?.uid
  if (!body || !uid) return
  await run(async () => {
    await data.addDeliverableNote(deliverableId.value, versions.value[0]?.id ?? '', uid, body)
    noteBody.value = ''
    await load()
  })
}

// ── Approve / request changes (same API flow as the portal list) ────────────
async function approve() {
  await run(async () => {
    const res = await apiFetch(`/orgs/${auth.activeOrgId}/deliverables/${deliverableId.value}/approve`, { method: 'POST' })
    if (!res.ok) { toast.error(t(res.error.key, res.error.params ?? {})); return }
    toast.success(t('portal.approved'))
    await load()
  })
}

const showChanges = ref(false)
const changesNote = ref('')
async function submitRequestChanges() {
  if (!changesNote.value.trim()) return
  await run(async () => {
    const res = await apiFetch(`/orgs/${auth.activeOrgId}/deliverables/${deliverableId.value}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ note: changesNote.value.trim() }),
    })
    if (!res.ok) { toast.error(t(res.error.key, res.error.params ?? {})); return }
    toast.success(t('portal.changesRequested'))
    showChanges.value = false
    await load()
  })
}
</script>

<template>
  <section v-if="deliverable">
    <RouterLink :to="{ name: 'portal' }" class="text-sm transition-colors hover:underline" style="color: var(--text-muted);">
      ← {{ t('portal.back') }}
    </RouterLink>

    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ deliverable.name }}</h1>
        <PriorityBadge :priority="deliverable.priority" />
        <span v-if="deliverable.approvedVia" class="text-sm" style="color: var(--accent-emerald);">
          ✓ {{ t('portal.approvedLabel') }}
        </span>
      </div>
      <div v-if="deliverable.status === 'active'" class="flex items-center gap-2">
        <button
          class="rounded-lg border px-3 py-1.5 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          :disabled="busy"
          @click="showChanges = true"
        >
          {{ t('portal.requestChanges') }}
        </button>
        <BaseButton :disabled="busy" @click="approve">{{ t('portal.approve') }}</BaseButton>
      </div>
    </div>

    <!-- Latest cut -->
    <a
      v-if="deliverable.latestVersionUrl"
      :href="deliverable.latestVersionUrl"
      target="_blank"
      rel="noopener"
      class="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
      style="background: var(--accent-cyan); color: var(--bg);"
    >
      ▶ {{ t('portal.latestCut') }}
      <!-- Version labels (v1, v2, …) are data, not copy — no i18n key. -->
      <span v-if="deliverable.latestVersionLabel" class="opacity-80">{{ deliverable.latestVersionLabel }}</span>
    </a>

    <!-- Stage progress (from stageSummary — no task reads) -->
    <div v-if="stages.length" class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('portal.progress') }}</h2>
      <p v-if="complete" class="mt-1 text-sm" style="color: var(--accent-emerald);">{{ t('portal.allStagesDone') }}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <component
          :is="linkedTaskId(stage) ? 'RouterLink' : 'span'"
          v-for="(stage, i) in stages"
          :key="stage.stageId"
          v-bind="linkedTaskId(stage) ? { to: { name: 'task', params: { taskId: linkedTaskId(stage) } } } : {}"
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
          :class="{ 'cursor-pointer transition-colors hover:brightness-110': linkedTaskId(stage) }"
          :style="{
            background: i === currentIndex ? 'var(--accent-cyan)' : 'var(--surface-2)',
            color: i === currentIndex ? 'var(--bg)' : 'var(--text)',
            borderColor: 'var(--border)',
          }"
        >
          <span class="h-2 w-2 rounded-full" :style="{ background: statusColor(stage.status) }" />
          {{ stage.name }}
        </component>
      </div>
    </div>

    <!-- Version history -->
    <div v-if="versions.length" class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('portal.versions') }}</h2>
      <div class="mt-2 space-y-2">
        <div v-for="v in versions" :key="v.id" class="rounded-lg border p-3" style="background: var(--surface-2); border-color: var(--border);">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-medium" style="color: var(--text);">{{ v.label }}</span>
            <div class="flex items-center gap-3">
              <a
                v-if="v.mediaUrl"
                :href="v.mediaUrl"
                target="_blank"
                rel="noopener"
                class="text-xs font-medium hover:underline"
                style="color: var(--accent-cyan);"
              >{{ t('portal.watch') }}</a>
              <span v-if="v.createdAt" class="text-xs" style="color: var(--text-muted);">{{ d(v.createdAt, 'short') }}</span>
            </div>
          </div>
          <p v-if="v.note" class="mt-1 text-xs" style="color: var(--text-muted);">{{ v.note }}</p>
        </div>
      </div>
    </div>

    <!-- Feedback thread -->
    <div class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('portal.feedback') }}</h2>
      <div v-if="notes.length" class="mt-2 space-y-2">
        <div v-for="n in notes" :key="n.id" class="rounded-lg border p-3" style="background: var(--surface); border-color: var(--border);">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text);">{{ data.userName(n.authorUid) }}</span>
            <span v-if="n.createdAt" class="text-xs" style="color: var(--text-muted);">{{ d(n.createdAt, 'short') }}</span>
          </div>
          <p class="mt-1 text-sm" style="color: var(--text);">{{ n.body }}</p>
        </div>
      </div>
      <form class="mt-3 flex items-start gap-2" @submit.prevent="sendNote">
        <textarea
          v-model="noteBody"
          rows="2"
          class="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          :placeholder="t('portal.feedbackPlaceholder')"
        />
        <BaseButton class="text-xs" :disabled="busy || !noteBody.trim()" @click="sendNote">
          {{ t('portal.send') }}
        </BaseButton>
      </form>
    </div>

    <!-- Request Changes Modal -->
    <Modal :open="showChanges" :title="t('portal.requestChangesTitle')" @close="showChanges = false">
      <form class="space-y-4" @submit.prevent="submitRequestChanges">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('portal.changesNoteLabel') }}</span>
          <textarea
            v-model="changesNote"
            rows="3"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            :placeholder="t('portal.changesNotePlaceholder')"
            autofocus
          />
        </label>
        <ModalFooter :label="t('portal.submitChanges')" :busy="busy" @cancel="showChanges = false" @submit="submitRequestChanges" />
      </form>
    </Modal>
  </section>

  <section v-else-if="loadError">
    <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
    <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
  </section>

  <section v-else-if="loaded">
    <p style="color: var(--text-muted);">{{ t('common.notFound') }}</p>
  </section>

  <section v-else>
    <p style="color: var(--text-muted);">{{ t('common.loading') }}</p>
  </section>
</template>
