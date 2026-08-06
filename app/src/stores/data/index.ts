// The `data` Pinia store: the app's single sanctioned door to Firestore.
// Components never touch the SDK directly — they call this store.
//
// It is assembled from per-collection slices so no one file has to hold the
// whole thing. Each slice is a factory that takes the shared `DataContext`
// (context.ts — the reactive document cache, the live-listener registry, the
// freshness memo, org scoping) and returns its public actions. This file wires
// them together and re-exports the flat public API, which is unchanged from
// when the store lived in a single module: every key below is what callers
// already use.
//
// Adding a surface: extend the slice that owns the collection, then add the
// new key to that slice's line in the return block. State that only one slice
// touches (paging cursors) stays inside it and registers `ctx.onReset`; state
// two slices share (`tasks`, `ledgerTasks`) belongs in the context.
import { defineStore } from 'pinia'
import { useAuthStore } from '../auth'
import { createDataContext } from './context'
import { createMembersSlice } from './members'
import { createClientsSlice } from './clients'
import { createProjectsSlice } from './projects'
import { createBoardSlice } from './board'
import { createDeliverablesSlice } from './deliverables'
import { createTasksSlice } from './tasks'
import { createLedgerSlice } from './ledger'
import { createFilteredTasksSlice } from './filteredTasks'
import { createCountersSlice } from './counters'
import { createInvitesSlice } from './invites'
import { createDeletesSlice } from './deletes'
import { createOrgSlice } from './org'
import { createSessionsSlice } from './sessions'
import { createPackagesSlice } from './packages'
import * as threads from './threads'

export const useDataStore = defineStore('data', () => {
  const ctx = createDataContext()

  const members = createMembersSlice(ctx)
  const clients = createClientsSlice(ctx)
  const projects = createProjectsSlice(ctx)
  const board = createBoardSlice(ctx)
  const deliverables = createDeliverablesSlice(ctx)
  const tasks = createTasksSlice(ctx)
  const ledger = createLedgerSlice(ctx)
  const queue = createFilteredTasksSlice(ctx)
  const counters = createCountersSlice(ctx)
  const invites = createInvitesSlice(ctx)
  const deletes = createDeletesSlice(ctx)
  const org = createOrgSlice(ctx)
  const sessions = createSessionsSlice(ctx)
  const packages = createPackagesSlice(ctx)

  // Everything a manager surface needs. Attaches the four org-wide listeners
  // and resolves once each has delivered its first snapshot; afterwards the
  // data keeps itself current and repeat calls are free.
  async function loadWorkspace(force = false): Promise<void> {
    await Promise.all([
      members.loadUsers(force),
      clients.loadClients(force),
      projects.loadAllProjects(force),
      tasks.loadAllTasks(force),
    ])
    // Clear the full-page loader if it's showing (post-login transition).
    const auth = useAuthStore()
    auth.transitioning = false
  }

  return {
    // Shared reactive collections (context.ts).
    usersById: ctx.usersById,
    clients: ctx.clients,
    projects: ctx.projects,
    subGroups: ctx.subGroups,
    tasks: ctx.tasks,
    deliverables: ctx.deliverables,
    invites: ctx.invites,
    ledgerTasks: ctx.ledgerTasks,

    // Sign-out / org-switch teardown, and the manager bootstrap.
    reset: ctx.reset,
    loadWorkspace,

    // loadUsers, userName, teamMembers, updateMember
    ...members,
    // loadClients, loadClient, getClient, createClient, updateClient
    ...clients,
    // projectsMayHaveMore, loadProjectsForClient, loadAllProjects,
    // loadMoreProjects, loadProject, getProject, createProject, updateProject
    ...projects,
    // loadProjectBoard, loadMoreSubGroups, projectHasMoreSubGroups,
    // loadAllSubGroupsForProject, subGroupsForProject, getSubGroup,
    // loadSubGroup, loadSubGroupWithChildren, createSubGroup, updateSubGroup
    ...board,
    // deliverablesForSubGroup, getDeliverable, loadDeliverable,
    // updateDeliverable, fetchClientPortalDeliverables
    ...deliverables,
    // tasksMayHaveMore, tasksForProject, getTask, loadTask, loadAssignedTasks,
    // tasksForAssignee, loadAllTasks, loadMoreTasks, loadTasksForClient,
    // loadAllTasksForClient, createTask, updateTask, updateTaskStatus,
    // setProjectTasksVisibility
    ...tasks,
    // ledgerMayHaveMore, loadLedger, loadMoreLedger
    ...ledger,
    // filteredTasks, filteredMayHaveMore, loadFilteredTasks,
    // loadMoreFilteredTasks
    ...queue,
    // fetchTaskStatusCounts, fetchTaskCountsForClients, fetchActiveTaskCounts,
    // fetchProjectCount
    ...counters,
    // loadInvites, createInvite, revokeInvite
    ...invites,
    // deleteTask, deleteSubGroup, deleteProject, deleteClient
    ...deletes,
    // updateOrgPipeline
    ...org,
    // createRecordingSession
    ...sessions,
    // loadPackagesForProject
    ...packages,
    // loadVersions, loadNotes, addNote, setNoteResolved, addVersion,
    // loadDeliverableVersions, loadDeliverableNotes, addDeliverableVersion,
    // addDeliverableNote, setDeliverableNoteResolved
    ...threads,
  }
})
