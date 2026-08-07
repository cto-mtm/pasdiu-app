<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import { useTaskStatusChange } from '../composables/useTaskStatusChange'
import { sanitizeExternalUrl } from '../lib/url'
import { statusKey } from '../lib/status'
import { fromDateInputValue, toDateInputValue } from '../lib/dates'
import type { Deliverable, Version, Note, MetaField } from '../lib/types'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import StatusBadge from '../components/StatusBadge.vue'
import BriefDrawer from '../components/BriefDrawer.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import MetaEditor from '../components/MetaEditor.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()

const taskId = computed(() => String(route.params.taskId))
// Single source of truth: the store's copy — mutations (approve, edit) reflect
// here without manual re-patching.
const task = computed(() => data.getTask(taskId.value))
const versions = ref<Version[]>([])
const notes = ref<Note[]>([])
const selectedVersionId = ref<string | null>(null)
const draft = ref('')
const briefOpen = ref(false)

const { busy, run } = useBusy()

const project = computed(() => (task.value ? data.getProject(task.value.projectId) : undefined))
const client = computed(() => (task.value ? data.getClient(task.value.clientId) : undefined))
const selectedVersion = computed(() => versions.value.find((v) => v.id === selectedVersionId.value))
// The selected version's notes PLUS deliverable-level notes (versionId '') —
// the portal's request-changes flow writes those, and the contractor redoing
// the work must see the client's reason here, not only on the portal.
const versionNotes = computed(() =>
  notes.value.filter((n) => n.versionId === selectedVersionId.value || n.versionId === ''),
)

// ── The thread's home ───────────────────────────────────────────
// A deliverable-linked task shares the DELIVERABLE's versions + feedback —
// one thread across every stage, so the recorder's cut and the client's note
// are exactly what the editor sees (README finding 1: handoffs must not lose
// notes). Only standalone tasks (deliverableId '') keep a private thread.
const threadDeliverableId = computed(() => task.value?.deliverableId || '')

async function refreshNotes() {
  notes.value = threadDeliverableId.value
    ? await data.loadDeliverableNotes(threadDeliverableId.value)
    : await data.loadNotes(taskId.value)
}

async function addNote() {
  const body = draft.value.trim()
  if (!body || !selectedVersionId.value || !auth.profile) return
  await run(async () => {
    if (threadDeliverableId.value) {
      await data.addDeliverableNote(threadDeliverableId.value, selectedVersionId.value!, auth.profile!.uid, body)
    } else {
      await data.addNote(taskId.value, selectedVersionId.value!, auth.profile!.uid, body)
    }
    draft.value = ''
    await refreshNotes()
  })
}

async function approve() {
  if (!task.value) return
  await run(() => data.updateTaskStatus(task.value!.id, 'approved'))
}

// Status control for whoever owns the work. Same permissions and same
// confirm-with-reason step as the board's TaskCard — crew no longer have to
// go back to the board to move a task they're looking at.
const {
  canChangeStatus: canChangeTaskStatus,
  statusOptions,
  confirmOpen: statusConfirmOpen,
  pendingStatus,
  pendingDetail,
  needsBlockedReason,
  asksDeliveryNote,
  confirmDisabled: statusConfirmDisabled,
  onSelect: onStatusSelect,
  confirmChange: confirmStatusChange,
  cancelChange: cancelStatusChange,
} = useTaskStatusChange(() => task.value)

// Add a new media version (v1, v2, …) with an optional note/description.
const canContribute = computed(() => auth.isManager || auth.role === 'contractor')
const showAddVersion = ref(false)
const versionNote = ref('')
const versionMediaUrl = ref('')
function openAddVersion() {
  versionNote.value = ''
  versionMediaUrl.value = ''
  showAddVersion.value = true
}
async function confirmAddVersion() {
  await run(async () => {
    // Media lives on the customer's own storage (MVP): store a sanitized link.
    const note = versionNote.value.trim()
    const url = sanitizeExternalUrl(versionMediaUrl.value)
    const v = threadDeliverableId.value
      ? await data.addDeliverableVersion(threadDeliverableId.value, note, url)
      : await data.addVersion(taskId.value, note, url)
    versions.value = [...versions.value, v]
    selectedVersionId.value = v.id
    showAddVersion.value = false
  })
}

// Edit task (title, description, assignee, metadata) — managers.
const showEditTask = ref(false)
const etTitle = ref('')
const etDesc = ref('')
const etAssignee = ref('')
const etClientVisible = ref(false)
const etBlockedReason = ref('')
const etDeliveryNote = ref('')
const etDueAt = ref('')
const etMeta = ref<MetaField[]>([])

function openEditTask() {
  if (!task.value) return
  etTitle.value = task.value.title
  etDesc.value = task.value.description
  etAssignee.value = task.value.assigneeUid
  etClientVisible.value = task.value.clientVisible
  etDueAt.value = toDateInputValue(task.value.dueAt)
  etBlockedReason.value = task.value.blockedReason
  etDeliveryNote.value = task.value.deliveryNote
  etMeta.value = task.value.meta.map((f) => ({ ...f }))
  showEditTask.value = true
}
async function saveTask() {
  if (!etTitle.value.trim() || !task.value) return
  await run(async () => {
    await data.updateTask(taskId.value, {
      title: etTitle.value.trim(),
      description: etDesc.value.trim(),
      assigneeUid: etAssignee.value,
      clientVisible: etClientVisible.value,
      // Overrides whatever the workflow's stage durations derived.
      dueAt: fromDateInputValue(etDueAt.value),
      // Reason/note are only editable (and only meaningful) in their status.
      ...(task.value!.status === 'blocked' ? { blockedReason: etBlockedReason.value.trim() } : {}),
      ...(task.value!.status === 'delivered' ? { deliveryNote: etDeliveryNote.value.trim() } : {}),
      meta: etMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    })
    showEditTask.value = false
  })
}

// Delete task
const showDeleteTask = ref(false)
async function confirmDeleteTask() {
  const projectId = task.value?.projectId
  await run(async () => {
    await data.deleteTask(taskId.value)
    showDeleteTask.value = false
    if (projectId) router.push({ name: 'project', params: { projectId } })
    else router.back()
  })
}

// Resolve / reopen a feedback note — managers or the note's author only
// (Firestore rules deny everyone else).
function canResolve(n: Note): boolean {
  return auth.isManager || n.authorUid === auth.profile?.uid
}
async function toggleResolve(n: Note) {
  await run(async () => {
    if (threadDeliverableId.value) {
      await data.setDeliverableNoteResolved(threadDeliverableId.value, n.id, !n.resolved)
    } else {
      await data.setNoteResolved(taskId.value, n.id, !n.resolved)
    }
    await refreshNotes()
  })
}

const loadError = ref(false)
const loaded = ref(false)
const parentDeliverable = ref<Deliverable | undefined>()
const previousStageNote = ref('')

// Stage context: if this task belongs to a deliverable, show which stage it is.
const stageContext = computed(() => {
  if (!task.value || !task.value.deliverableId || !parentDeliverable.value) return null
  const del = parentDeliverable.value
  const stageIndex = del.stages.findIndex((s) => s.id === task.value!.stageId)
  if (stageIndex === -1) return null
  return { index: stageIndex, total: del.stages.length, name: del.stages[stageIndex].name, deliverableId: del.id, deliverableName: del.name }
})

async function load() {
  loadError.value = false
  try {
    await data.loadUsers()
    const tk = await data.loadTask(taskId.value)
    if (tk) {
      // Load only THIS task's client/project (client role can't query all clients).
      await Promise.all([data.loadClient(tk.clientId), data.loadProject(tk.projectId)])
      // Deliverable-linked tasks read the deliverable's shared thread.
      versions.value = tk.deliverableId
        ? await data.loadDeliverableVersions(tk.deliverableId)
        : await data.loadVersions(taskId.value)
      selectedVersionId.value = versions.value.at(-1)?.id ?? null
      await refreshNotes()

      // Load parent deliverable for stage context.
      if (tk.deliverableId) {
        const del = await data.loadDeliverable(tk.deliverableId)
        if (del) {
          parentDeliverable.value = del

          // Find previous stage's handoff note (deliveryNote on the prior task).
          const stageIndex = del.stages.findIndex((s) => s.id === tk.stageId)
          if (stageIndex > 0) {
            const prevStageId = del.stages[stageIndex - 1].id
            const { getDocs: gd, query: q, collection: col, where: w } = await import('firebase/firestore')
            const { db: fireDb } = await import('../lib/firebase')
            const prevSnap = await gd(q(
              col(fireDb, 'tasks'),
              w('deliverableId', '==', tk.deliverableId),
              w('stageId', '==', prevStageId),
            ))
            if (!prevSnap.empty) {
              const prevTask = prevSnap.docs[0].data()
              previousStageNote.value = (prevTask.deliveryNote as string) ?? ''
            }
          }
        }
      }
    }
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="task">
    <Breadcrumbs
      class="mb-4"
      :items="[
        { label: t('dashboard.title'), to: { name: 'dashboard' } },
        { label: client?.name ?? '…', to: client ? { name: 'client', params: { clientId: client.id } } : undefined },
        { label: project?.name ?? '…', to: project ? { name: 'project', params: { projectId: project.id } } : undefined },
        { label: task.title },
      ]"
    />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ task.title }}</h1>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <StatusBadge :status="task.status" />
          <!-- Managers and the assigned contractor move the task from here. -->
          <select
            v-if="canChangeTaskStatus"
            class="rounded border px-2 py-1 text-xs outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            :value="task.status"
            :aria-label="t('board.changeStatus')"
            @change="onStatusSelect"
          >
            <option v-for="s in statusOptions" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
          </select>
          <span class="text-sm" style="color: var(--text-muted);">{{ data.userName(task.assigneeUid) }}</span>
        </div>
        <!-- Blocked reasons are internal — never rendered for the client role. -->
        <p v-if="task.status === 'blocked' && task.blockedReason && auth.role !== 'client'" class="mt-2 text-sm" style="color: var(--status-blocked);">
          {{ t('board.blockedReasonLabel') }}: {{ task.blockedReason }}
        </p>
        <p v-else-if="task.status === 'delivered' && task.deliveryNote" class="mt-2 text-sm" style="color: var(--text-muted);">
          {{ t('board.deliveryNoteLabel') }}: {{ task.deliveryNote }}
        </p>
        <!-- Stage context when task belongs to a deliverable -->
        <div v-if="stageContext" class="mt-2 flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          <span class="rounded bg-[color:var(--surface-2)] px-2 py-0.5 text-xs font-medium">
            {{ t('deliverableDetail.stageContext', { n: stageContext.index + 1, total: stageContext.total }) }}
          </span>
          <RouterLink :to="{ name: 'deliverable', params: { deliverableId: stageContext.deliverableId } }" class="text-xs underline" style="color: var(--accent-cyan);">
            {{ t('deliverableDetail.viewDeliverable') }} — {{ stageContext.deliverableName }}
          </RouterLink>
        </div>
        <p v-if="stageContext && previousStageNote" class="mt-2 rounded-lg border p-2 text-sm" style="background: var(--surface-2); border-color: var(--border); color: var(--text);">
          <span class="text-xs font-medium" style="color: var(--text-muted);">{{ t('deliverableDetail.handoffNote', { stage: parentDeliverable?.stages[stageContext.index - 1]?.name ?? '' }) }}</span><br>
          {{ previousStageNote }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <!-- Brief is viewable by everyone with task access (managers, editors, clients). -->
        <button
          class="rounded-lg border px-3 py-1.5 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="briefOpen = true"
        >
          {{ t('brief.open') }}
        </button>
        <button
          v-if="auth.isManager"
          class="rounded-lg border px-3 py-1.5 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="openEditTask"
        >
          {{ t('iteration.editTask') }}
        </button>
        <button
          v-if="auth.role === 'client' && task.status !== 'approved'"
          class="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style="background: var(--accent-emerald); color: var(--bg);"
          :disabled="busy"
          @click="approve"
        >
          {{ t('iteration.approve') }}
        </button>
      </div>
    </div>

    <!-- Description + task metadata -->
    <p v-if="task.description" class="mt-4 max-w-prose text-sm leading-relaxed" style="color: var(--text-muted);">
      {{ task.description }}
    </p>
    <dl v-if="task.meta.length" class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
      <div v-for="(f, i) in task.meta" :key="i">
        <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
        <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
      </div>
    </dl>

    <!-- Split-screen when the selected version has media: media left, version
         timeline + threaded notes right. Without media there's nothing to show
         on the left, so the pane is omitted entirely (no fake-player placeholder)
         and the timeline takes the full width. -->
    <div class="mt-6 grid grid-cols-1 gap-6" :class="selectedVersion?.mediaUrl ? 'lg:grid-cols-[1.4fr_1fr]' : ''">
      <!-- Media pane: media lives on the customer's own storage (Drive, Dropbox,
           Frame.io…) — the pane opens the version's link in a new tab. -->
      <div v-if="selectedVersion?.mediaUrl">
        <a
          :href="selectedVersion.mediaUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="group flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border transition-colors"
          style="background: var(--surface-2); border-color: var(--border);"
        >
          <span class="flex h-14 w-14 items-center justify-center rounded-full transition-transform group-hover:scale-105 motion-reduce:transition-none" style="background: rgba(0,0,0,0.45);">
            <svg viewBox="0 0 24 24" class="h-6 w-6" style="color: #fff;" aria-hidden="true">
              <path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="text-sm font-medium underline-offset-2 group-hover:underline" style="color: var(--text);">{{ t('iteration.openMedia') }}</span>
          <span class="max-w-[80%] truncate text-xs" style="color: var(--text-muted);">{{ selectedVersion.mediaUrl }}</span>
        </a>
        <p v-if="selectedVersion.note" class="mt-2 text-sm" style="color: var(--text-muted);">
          {{ selectedVersion.label }} — {{ selectedVersion.note }}
        </p>
      </div>

      <!-- Timeline + notes -->
      <div>
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('iteration.versions') }}</h2>
          <button
            v-if="canContribute"
            class="rounded-lg border px-2 py-1 text-xs"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            @click="openAddVersion"
          >
            + {{ t('iteration.addVersion') }}
          </button>
        </div>
        <!-- Make the shared-thread model visible: cuts and feedback here are
             the deliverable's, not this stage's alone. -->
        <p v-if="threadDeliverableId" class="mt-1 text-xs" style="color: var(--text-muted);">
          {{ t('iteration.sharedThread') }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="v in versions"
            :key="v.id"
            class="rounded-lg border px-3 py-1.5 text-sm transition-colors"
            :style="{
              background: v.id === selectedVersionId ? 'var(--accent-cyan)' : 'var(--surface)',
              color: v.id === selectedVersionId ? 'var(--bg)' : 'var(--text)',
              borderColor: 'var(--border)',
            }"
            @click="selectedVersionId = v.id"
          >
            {{ v.label }}
          </button>
          <span v-if="!versions.length" class="text-sm" style="color: var(--text-muted);">{{ t('iteration.noVersions') }}</span>
        </div>
        <!-- Version note lives here when there's no media pane to caption. -->
        <p v-if="!selectedVersion?.mediaUrl && selectedVersion?.note" class="mt-2 text-sm" style="color: var(--text-muted);">
          {{ selectedVersion.note }}
        </p>

        <h2 class="mt-6 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('iteration.feedback') }}</h2>
        <TransitionGroup name="list" tag="div" class="mt-2 space-y-2">
          <div
            v-for="n in versionNotes"
            :key="n.id"
            class="rounded-lg border p-3"
            :style="{ background: 'var(--surface)', borderColor: n.resolved ? 'var(--accent-emerald)' : 'var(--border)' }"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium" style="color: var(--text);">{{ data.userName(n.authorUid) }}</span>
              <div class="flex items-center gap-2">
                <span v-if="n.createdAt" class="text-xs" style="color: var(--text-muted);">{{ d(n.createdAt, 'short') }}</span>
                <button
                  v-if="canResolve(n)"
                  class="text-xs"
                  :style="{ color: n.resolved ? 'var(--accent-emerald)' : 'var(--text-muted)' }"
                  @click="toggleResolve(n)"
                >
                  {{ n.resolved ? t('iteration.resolved') : t('iteration.resolve') }}
                </button>
              </div>
            </div>
            <p class="mt-1 text-sm" :class="{ 'line-through opacity-60': n.resolved }" style="color: var(--text);">{{ n.body }}</p>
          </div>
        </TransitionGroup>
        <p v-if="selectedVersionId && !versionNotes.length" class="mt-2 text-sm" style="color: var(--text-muted);">
          {{ t('iteration.noFeedback') }}
        </p>

        <form v-if="selectedVersionId" class="mt-3 flex gap-2" @submit.prevent="addNote">
          <input
            v-model="draft"
            :placeholder="t('iteration.addNote')"
            class="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
          />
          <button
            type="submit"
            class="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
            style="background: var(--accent-cyan); color: var(--bg);"
            :disabled="busy"
          >
            {{ t('iteration.send') }}
          </button>
        </form>
      </div>
    </div>

    <!-- A task knows its whole chain, so the brief here is the full picture:
         client → project → sub-group → deliverable. -->
    <BriefDrawer
      :open="briefOpen"
      :client-id="task.clientId"
      :project-id="task.projectId"
      :sub-group-id="task.subGroupId || null"
      :deliverable-id="task.deliverableId || null"
      @close="briefOpen = false"
    />

    <!-- Edit task -->
    <Modal :open="showEditTask" :title="t('iteration.editTask')" @close="showEditTask = false">
      <form class="space-y-4" @submit.prevent="saveTask">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.titleLabel') }}</span>
          <BaseInput v-model="etTitle" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.descriptionLabel') }}</span>
          <textarea
            v-model="etDesc"
            rows="3"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.assigneeLabel') }}</span>
          <BaseSelect v-model="etAssignee">
            <option v-for="u in data.teamMembers" :key="u.uid" :value="u.uid">{{ u.displayName }}</option>
          </BaseSelect>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.dueLabel') }}</span>
          <BaseInput v-model="etDueAt" type="date" />
          <span class="mt-1 block text-xs" style="color: var(--text-muted);">{{ t('actions.dueHint') }}</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="etClientVisible" type="checkbox" class="mt-0.5" />
          <span>
            <span class="block text-sm" style="color: var(--text);">{{ t('actions.clientVisibleLabel') }}</span>
            <span class="block text-xs" style="color: var(--text-muted);">{{ t('actions.clientVisibleHint') }}</span>
          </span>
        </label>
        <label v-if="task.status === 'blocked'" class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('board.blockedReasonLabel') }}</span>
          <textarea
            v-model="etBlockedReason"
            rows="2"
            :placeholder="t('board.blockedReasonPlaceholder')"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <label v-if="task.status === 'delivered'" class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('board.deliveryNoteLabel') }}</span>
          <textarea
            v-model="etDeliveryNote"
            rows="2"
            :placeholder="t('board.deliveryNotePlaceholder')"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="etMeta"
            :suggestions="[t('meta.format'), t('meta.duration'), t('meta.aspectRatio'), t('meta.links')]"
          />
        </div>
        <div class="flex items-end justify-between gap-2">
          <!-- A deliverable's stage tasks can't be deleted individually — that
               would break its derived-stage pipeline (delete the deliverable). -->
          <button v-if="!task.deliverableId" type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--accent-amber);" @click="showEditTask = false; showDeleteTask = true">
            {{ t('actions.deleteTask') }}
          </button>
          <p v-else class="max-w-[16rem] text-xs" style="color: var(--text-muted);">
            {{ t('actions.deleteTaskInDeliverable') }}
          </p>
          <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEditTask = false" @submit="saveTask" />
        </div>
      </form>
    </Modal>

    <!-- Status change confirmation. Blocked demands a documented reason;
         delivered offers a delivery note. -->
    <ConfirmDialog
      :open="statusConfirmOpen"
      :title="t('board.confirmTitle')"
      :message="t('board.confirmBody', { title: task.title, status: pendingStatus ? t(statusKey(pendingStatus)) : '' })"
      :confirm-disabled="statusConfirmDisabled"
      @confirm="confirmStatusChange"
      @cancel="cancelStatusChange"
    >
      <label v-if="needsBlockedReason || asksDeliveryNote" class="mt-3 block">
        <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">
          {{ needsBlockedReason ? t('board.blockedReasonLabel') : t('board.deliveryNoteLabel') }}
        </span>
        <textarea
          v-model="pendingDetail"
          rows="2"
          :placeholder="needsBlockedReason ? t('board.blockedReasonPlaceholder') : t('board.deliveryNotePlaceholder')"
          class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
        />
      </label>
    </ConfirmDialog>

    <ConfirmDialog
      :open="showDeleteTask"
      danger
      :title="t('actions.deleteTask')"
      :message="t('actions.deleteTaskConfirm', { title: task.title })"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDeleteTask"
      @cancel="showDeleteTask = false"
    />

    <!-- Add version -->
    <Modal :open="showAddVersion" :title="t('iteration.addVersion')" @close="showAddVersion = false">
      <form class="space-y-4" @submit.prevent="confirmAddVersion">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('iteration.versionNote') }}</span>
          <textarea
            v-model="versionNote"
            rows="2"
            :placeholder="t('iteration.versionNotePlaceholder')"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('iteration.mediaLink') }}</span>
          <BaseInput v-model="versionMediaUrl" type="url" :placeholder="t('iteration.mediaLinkPlaceholder')" />
        </label>
        <ModalFooter :label="t('iteration.addVersion')" :busy="busy" @cancel="showAddVersion = false" @submit="confirmAddVersion" />
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
