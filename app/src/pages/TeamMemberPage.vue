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
import type { Role } from '../lib/types'
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

const assigned = computed(() => data.tasks.filter((tk) => tk.assigneeUid === uid.value))
const working = computed(() => assigned.value.filter((tk) => !isDoneStatus(tk.status)))
const completed = computed(() => assigned.value.filter((tk) => isDoneStatus(tk.status)))

// Edit member
const showEdit = ref(false)
const editName = ref('')
const editRole = ref<Role>('contractor')
const editClientId = ref('')
const clientError = ref(false)
const { busy, run } = useBusy()

function openEdit() {
  if (!member.value) return
  editName.value = member.value.displayName
  editRole.value = member.value.role
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
    await data.loadWorkspace()
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="member">
    <Breadcrumbs class="mb-4" :items="[{ label: t('team.title'), to: { name: 'team' } }, { label: member.displayName }]" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold" style="background: var(--surface-2); color: var(--accent-cyan);">
          {{ member.displayName.slice(0, 1) }}
        </div>
        <div>
          <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ member.displayName }}</h1>
          <p class="text-sm" style="color: var(--text-muted);">{{ t('roles.' + member.role) }} · {{ member.email }}</p>
        </div>
      </div>
      <BaseButton v-if="auth.isManager" @click="openEdit">{{ t('team.editMember') }}</BaseButton>
    </div>

    <!-- Working on -->
    <div class="mt-8">
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
    <div class="mt-8">
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
