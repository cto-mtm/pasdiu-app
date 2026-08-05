<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { removeMemberApi } from '../lib/api'
import { ROLES } from '../lib/types'
import type { Deliverable, Role } from '../lib/types'
import { isDoneStatus } from '../lib/status'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import TaskRow from '../components/TaskRow.vue'

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()
const toast = useToastStore()

const uid = computed(() => String(route.params.uid))
const member = computed(() => data.usersById[uid.value])

// Client contacts are reviewers, never assignees — showing them empty
// "Working on / Completed" sections reads like missing data. They get a
// portal-contact panel instead, and the breadcrumb roots at their client.
const isClientContact = computed(() => member.value?.role === 'client')
const boundClient = computed(() =>
  member.value?.clientId ? data.getClient(member.value.clientId) : undefined,
)
const crumbs = computed(() =>
  isClientContact.value && boundClient.value
    ? [
        { label: boundClient.value.name, to: { name: 'client', params: { clientId: boundClient.value.id } } },
        { label: member.value?.displayName ?? '' },
      ]
    : [
        { label: t('team.title'), to: { name: 'team' } },
        { label: member.value?.displayName ?? '' },
      ],
)

const assigned = computed(() => data.tasks.filter((tk) => tk.assigneeUid === uid.value))
const working = computed(() => assigned.value.filter((tk) => !isDoneStatus(tk.status)))
const completed = computed(() => assigned.value.filter((tk) => isDoneStatus(tk.status)))

// The contact's portal, from the manager's side: everything shared with
// their client, awaiting-review first — this is the "do they need to approve
// something?" answer at a glance.
const portalDeliverables = ref<Deliverable[]>([])
const sortedPortal = computed(() =>
  [...portalDeliverables.value].sort(
    (a, b) => ((a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)) || a.order - b.order,
  ),
)
const awaitingCount = computed(() => portalDeliverables.value.filter((del) => del.status === 'active').length)

// Edit member
const showEdit = ref(false)
const editName = ref('')
const editRole = ref<Role>('contractor')
const editTitle = ref('')
const editClientId = ref('')
const clientError = ref(false)
const { busy, run } = useBusy()

function openEdit() {
  if (!member.value) return
  editName.value = member.value.displayName
  editRole.value = member.value.role
  editTitle.value = member.value.title ?? ''
  editClientId.value = member.value.clientId ?? ''
  clientError.value = false
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim()) return
  // The client role must be tied to a client entity — rules gate their reads by it.
  clientError.value = editRole.value === 'client' && !editClientId.value
  if (clientError.value) return
  await run(async () => {
    await data.updateMember(uid.value, {
      displayName: editName.value.trim(),
      role: editRole.value,
      ...(editRole.value === 'client' ? { clientId: editClientId.value } : {}),
      ...(editRole.value !== 'client' ? { title: editTitle.value.trim() } : {}),
    })
    showEdit.value = false
  })
}

// Remove from workspace (HTTP API — membership deletes never happen client-
// side). The org owner isn't knowable here; the API rejects that case and the
// error surfaces as a toast.
const showRemove = ref(false)
async function removeMember() {
  await run(async () => {
    const res = await removeMemberApi(auth.activeOrgId ?? '', uid.value)
    showRemove.value = false
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    toast.success(t('team.removed'))
    if (uid.value === auth.profile?.uid) {
      // Removed OURSELF: the auth state (memberships/active org) is now
      // stale, not just the data store — refreshMemberships → ensureActiveOrg
      // resets the data store and routes to the next org's home (or /welcome).
      await auth.refreshMemberships()
      return
    }
    // Clean slate: TeamPage refetches the roster (and everything else it
    // needs) on mount, so the removed member can't ghost in usersById.
    data.reset()
    await router.replace({ name: 'team' })
  })
}

const loadError = ref(false)
const loaded = ref(false)
async function load() {
  loadError.value = false
  try {
    // The per-uid assigned listener streams this member's FULL task history —
    // the org-wide window only holds the first page of tasks by document id,
    // so it could silently miss part of their work. Users/clients/projects
    // listeners feed the name lookups on the rows.
    await Promise.all([data.loadUsers(), data.loadClients(), data.loadAllProjects()])
    // Contacts get their portal contents (what's shared / awaiting review)
    // instead of an assigned-tasks listener — they're reviewers, not
    // assignees, so that listener would just be an empty query held open.
    const m = data.usersById[uid.value]
    if (m?.role !== 'client') {
      await data.loadAssignedTasks(uid.value)
    } else if (m.clientId) {
      portalDeliverables.value = await data.fetchClientPortalDeliverables(m.clientId)
    }
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="member">
    <Breadcrumbs class="mb-4" :items="crumbs" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold" style="background: var(--surface-2); color: var(--accent-cyan);">
          {{ member.displayName.slice(0, 1) }}
        </div>
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold tracking-tight" style="color: var(--text);">
            {{ member.displayName }}
            <span
              v-if="member.uid === auth.org?.ownerUid"
              class="rounded px-2 py-0.5 text-xs font-medium"
              style="background: color-mix(in srgb, var(--accent-cyan) 15%, transparent); color: var(--accent-cyan);"
            >{{ t('team.owner') }}</span>
          </h1>
          <p class="text-sm" style="color: var(--text-muted);">
            {{ t('roles.' + member.role) }}<template v-if="member.title"> · {{ member.title }}</template> · {{ member.email }}
          </p>
        </div>
      </div>
      <BaseButton v-if="auth.isManager" @click="openEdit">{{ t('team.editMember') }}</BaseButton>
    </div>

    <!-- Client contact: no workload sections — they review, they're never
         assigned. Point back at their client instead. -->
    <div v-if="isClientContact" class="mt-8 rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.portalContact') }}</h2>
        <span
          v-if="awaitingCount"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          style="background: color-mix(in srgb, var(--accent-amber) 15%, transparent); color: var(--accent-amber);"
        >{{ awaitingCount }} {{ t('portal.awaitingReview') }}</span>
      </div>
      <p class="mt-2 text-sm" style="color: var(--text);">
        {{ boundClient ? t('team.portalContactBody', { name: boundClient.name }) : t('team.noClientLinked') }}
      </p>
      <RouterLink
        v-if="boundClient"
        :to="{ name: 'client', params: { clientId: boundClient.id } }"
        class="mt-3 inline-flex items-center gap-1 text-sm font-medium hover:underline"
        style="color: var(--accent-cyan);"
      >
        {{ t('team.viewClient') }} →
      </RouterLink>

      <!-- Everything shared into their portal, awaiting-review first. Rows
           link to the manager deliverable page (this page is manager-only). -->
      <div v-if="sortedPortal.length" class="mt-4">
        <h3 class="text-xs font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
          {{ t('team.inPortal') }} <span style="color: var(--text);">({{ sortedPortal.length }})</span>
        </h3>
        <div class="mt-2 divide-y overflow-hidden rounded-lg border" style="border-color: var(--border);">
          <RouterLink
            v-for="del in sortedPortal"
            :key="del.id"
            :to="{ name: 'deliverable', params: { deliverableId: del.id } }"
            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-[color:var(--surface-2)]"
            style="background: var(--surface);"
          >
            <span class="text-sm" style="color: var(--text);">{{ del.name }}</span>
            <span
              v-if="del.status === 'active'"
              class="rounded px-1.5 py-0.5 text-xs font-medium"
              style="background: color-mix(in srgb, var(--accent-amber) 15%, transparent); color: var(--accent-amber);"
            >{{ t('team.awaitingReview') }}</span>
            <span v-else-if="del.approvedVia" class="text-xs" style="color: var(--accent-emerald);">
              ✓ {{ t('portal.approvedLabel') }}
            </span>
          </RouterLink>
        </div>
      </div>
      <p v-else-if="boundClient" class="mt-3 text-xs" style="color: var(--text-muted);">
        {{ t('team.portalNothingShared') }}
      </p>
    </div>

    <!-- Working on -->
    <div v-if="!isClientContact" class="mt-8">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
        {{ t('team.workingOn') }} <span style="color: var(--text);">({{ working.length }})</span>
      </h2>
      <p v-if="!working.length" class="mt-2 text-sm" style="color: var(--text-muted);">{{ t('team.nothingActive') }}</p>
      <div v-else class="mt-3 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
        <TaskRow
          v-for="tk in working"
          :key="tk.id"
          :task="tk"
          :context="[data.getClient(tk.clientId)?.name, data.getProject(tk.projectId)?.name].filter(Boolean).join(' · ')"
        />
      </div>
    </div>

    <!-- Completed -->
    <div v-if="!isClientContact" class="mt-8">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
        {{ t('team.completed') }} <span style="color: var(--text);">({{ completed.length }})</span>
      </h2>
      <p v-if="!completed.length" class="mt-2 text-sm" style="color: var(--text-muted);">{{ t('team.nothingDone') }}</p>
      <div v-else class="mt-3 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
        <TaskRow
          v-for="tk in completed"
          :key="tk.id"
          :task="tk"
          :context="[data.getClient(tk.clientId)?.name, data.getProject(tk.projectId)?.name].filter(Boolean).join(' · ')"
        >
          <template #meta>
            <span v-if="tk.completedAt" class="hidden text-xs sm:inline" style="color: var(--text-muted);">{{ d(tk.completedAt, 'short') }}</span>
          </template>
        </TaskRow>
      </div>
    </div>

    <Modal :open="showEdit" :title="t('team.editMember')" @close="showEdit = false">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.nameLabel') }}</span>
          <BaseInput v-model="editName" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('settings.role') }}</span>
          <BaseSelect v-model="editRole">
            <option v-for="r in ROLES" :key="r" :value="r">{{ t('roles.' + r) }}</option>
          </BaseSelect>
        </label>
        <label v-if="editRole !== 'client'" class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.titleLabel') }}</span>
          <BaseInput v-model="editTitle" :placeholder="t('team.titlePlaceholder')" />
        </label>
        <label v-if="editRole === 'client'" class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.clientLabel') }}</span>
          <BaseSelect v-model="editClientId">
            <option v-for="c in data.clients" :key="c.id" :value="c.id">{{ c.name }}</option>
          </BaseSelect>
          <span v-if="clientError" class="mt-1 block text-xs" style="color: var(--accent-amber);">{{ t('team.clientRequired') }}</span>
        </label>
        <div class="flex items-end justify-between gap-2">
          <button type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--accent-amber);" @click="showEdit = false; showRemove = true">
            {{ t('team.removeMember') }}
          </button>
          <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEdit = false" @submit="saveEdit" />
        </div>
      </form>
    </Modal>

    <ConfirmDialog
      :open="showRemove"
      :title="t('team.removeMember')"
      :message="t('team.removeConfirm', { name: member.displayName })"
      danger
      :confirm-label="t('actions.remove')"
      @confirm="removeMember"
      @cancel="showRemove = false"
    />
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
