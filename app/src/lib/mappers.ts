// Pure Firestore-doc → domain-model converters. Deliberately NO firebase
// imports — the SDK stays confined to the stores (per CLAUDE.md), so these
// take plain `(id, data)` pairs and are trivially unit-testable.
import { FREE_LIMITS } from './plans'
import type {
  Client, Deliverable, DeliverablePriority, DeliverableStatus, DeliverableType, Invite, Membership, MetaField, Note, Org, OrgUsage, Package, PackageLine, Plan, Project, RecordingSession, Role, StageSummaryEntry, SubGroup, SubscriptionStatus,
  Task, TaskStatus, UserProfile, Version, WorkflowPipeline, WorkflowStage,
} from './types'

// ── Typed extraction helpers ────────────────────────────────────
// Reduce the per-mapper boilerplate of `(d.field as Type) ?? fallback` to
// intent-revealing one-liners.
type DocData = Record<string, unknown>

/** Firestore Timestamp | null → JS Date | null. Duck-typed so we don't need the SDK class. */
export function toDate(v: unknown): Date | null {
  if (
    v !== null &&
    typeof v === 'object' &&
    'toDate' in v &&
    typeof (v as { toDate: unknown }).toDate === 'function'
  ) {
    return (v as { toDate: () => Date }).toDate()
  }
  return null
}

function str(d: DocData, key: string, fallback = ''): string {
  return (d[key] as string) ?? fallback
}

function num(d: DocData, key: string, fallback = 0): number {
  return (d[key] as number) ?? fallback
}

function bool(d: DocData, key: string, fallback = false): boolean {
  return (d[key] as boolean) ?? fallback
}

function arr<T>(d: DocData, key: string): T[] {
  return (d[key] as T[]) ?? []
}

/** Normalize a stages array — old docs may lack durationHours. */
function normalizeStages(raw: unknown): WorkflowStage[] {
  return ((raw as WorkflowStage[]) ?? []).map(
    (s): WorkflowStage => ({ ...s, durationHours: s.durationHours ?? 0 }),
  )
}

// ── Mappers ─────────────────────────────────────────────────────

export function mapClient(id: string, d: DocData): Client {
  return { id, orgId: str(d, 'orgId'), name: str(d, 'name'), meta: arr<MetaField>(d, 'meta') }
}

export function mapSubGroup(id: string, d: DocData): SubGroup {
  return {
    id,
    orgId: str(d, 'orgId'),
    projectId: str(d, 'projectId'),
    name: str(d, 'name'),
    order: num(d, 'order'),
    meta: arr<MetaField>(d, 'meta'),
  }
}

export function mapProject(id: string, d: DocData): Project {
  const b = (d.brief as DocData) ?? {}
  return {
    id,
    orgId: str(d, 'orgId'),
    clientId: str(d, 'clientId'),
    name: str(d, 'name'),
    defaultView: (d.defaultView as 'kanban' | 'list' | 'deliverables') ?? 'kanban',
    brief: {
      brandGuidelinesUrl: str(b, 'brandGuidelinesUrl'),
      sopUrl: str(b, 'sopUrl'),
      links: arr<string>(b, 'links'),
      fields: arr<MetaField>(b, 'fields'),
    },
    meta: arr<MetaField>(d, 'meta'),
  }
}

export function mapTask(id: string, d: DocData): Task {
  return {
    id,
    orgId: str(d, 'orgId'),
    title: str(d, 'title'),
    description: str(d, 'description'),
    subGroupId: str(d, 'subGroupId'),
    projectId: str(d, 'projectId'),
    clientId: str(d, 'clientId'),
    status: d.status as TaskStatus,
    assigneeUid: str(d, 'assigneeUid'),
    clientVisible: bool(d, 'clientVisible'),
    blockedReason: str(d, 'blockedReason'),
    blockedAt: toDate(d.blockedAt),
    deliveryNote: str(d, 'deliveryNote'),
    meta: arr<MetaField>(d, 'meta'),
    order: num(d, 'order'),
    dueAt: toDate(d.dueAt),
    createdAt: toDate(d.createdAt),
    completedAt: toDate(d.completedAt),
    deliverableId: str(d, 'deliverableId'),
    stageId: str(d, 'stageId'),
  }
}

export function mapVersion(id: string, d: DocData): Version {
  return {
    id,
    label: str(d, 'label'),
    note: str(d, 'note'),
    createdAt: toDate(d.createdAt),
    mediaUrl: str(d, 'mediaUrl'),
  }
}

export function mapOrg(id: string, d: DocData): Org {
  return {
    id,
    name: str(d, 'name'),
    ownerUid: str(d, 'ownerUid'),
    plan: (d.plan as Plan) ?? 'free',
    seatLimit: num(d, 'seatLimit', FREE_LIMITS.seatLimit),
    clientLimit: num(d, 'clientLimit', FREE_LIMITS.clientLimit),
    taskLimit: num(d, 'taskLimit', FREE_LIMITS.taskLimit),
    deliverableLimit: num(d, 'deliverableLimit', FREE_LIMITS.deliverableLimit),
    subscriptionStatus: (d.subscriptionStatus as SubscriptionStatus) ?? 'none',
    currentPeriodEnd: toDate(d.currentPeriodEnd),
    pipeline: {
      stages: normalizeStages((d.pipeline as Partial<WorkflowPipeline> | undefined)?.stages),
    },
  }
}

export function mapUsage(d: DocData): OrgUsage {
  return {
    seats: num(d, 'seats'),
    activeClients: num(d, 'activeClients'),
    activeTasks: num(d, 'activeTasks'),
    activeDeliverables: num(d, 'activeDeliverables'),
  }
}

export function mapMember(id: string, d: DocData): UserProfile {
  return {
    uid: id,
    displayName: str(d, 'displayName'),
    email: str(d, 'email'),
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
    title: (d.title as string) || undefined,
  }
}

export function mapMembership(d: DocData): Membership {
  return {
    orgId: str(d, 'orgId'),
    orgName: str(d, 'orgName'),
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
    title: (d.title as string) || undefined,
  }
}

export function mapInvite(id: string, d: DocData): Invite {
  return {
    id,
    email: str(d, 'email'),
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
    status: d.status as Invite['status'],
    createdAt: toDate(d.createdAt),
    invitedBy: str(d, 'invitedBy'),
    locale: d.locale as Invite['locale'],
    expiresAt: toDate(d.expiresAt),
  }
}

export function mapNote(id: string, d: DocData): Note {
  return {
    id,
    versionId: str(d, 'versionId'),
    authorUid: str(d, 'authorUid'),
    body: str(d, 'body'),
    resolved: bool(d, 'resolved'),
    createdAt: toDate(d.createdAt),
  }
}

export function mapDeliverable(id: string, d: DocData): Deliverable {
  return {
    id,
    orgId: str(d, 'orgId'),
    clientId: str(d, 'clientId'),
    projectId: str(d, 'projectId'),
    subGroupId: str(d, 'subGroupId'),
    subGroupName: str(d, 'subGroupName'),
    typeId: str(d, 'typeId'),
    stages: normalizeStages(d.stages),
    stageSummary: (arr<DocData>(d, 'stageSummary')).map(
      (s): StageSummaryEntry => ({
        stageId: str(s, 'stageId'),
        name: str(s, 'name'),
        status: s.status as TaskStatus,
        assigneeUid: str(s, 'assigneeUid'),
        assigneeName: str(s, 'assigneeName'),
        dueAt: toDate(s.dueAt),
        taskId: str(s, 'taskId'),
        clientVisible: bool(s, 'clientVisible'),
      })
    ),
    name: str(d, 'name'),
    status: (d.status as DeliverableStatus) ?? 'active',
    priority: (d.priority as DeliverablePriority) ?? 'normal',
    clientVisible: bool(d, 'clientVisible'),
    latestVersionUrl: str(d, 'latestVersionUrl'),
    latestVersionLabel: str(d, 'latestVersionLabel'),
    order: num(d, 'order'),
    meta: arr<MetaField>(d, 'meta'),
    createdAt: toDate(d.createdAt),
    deliveredAt: toDate(d.deliveredAt),
    approvedBy: str(d, 'approvedBy'),
    approvedVia: (d.approvedVia as Deliverable['approvedVia']) ?? '',
    approvedAt: toDate(d.approvedAt),
    approvalNote: str(d, 'approvalNote'),
  }
}

export function mapDeliverableType(id: string, d: DocData): DeliverableType {
  return {
    id,
    orgId: str(d, 'orgId'),
    name: str(d, 'name'),
    weight: num(d, 'weight', 1),
    order: num(d, 'order'),
  }
}

export function mapPackage(id: string, d: DocData): Package {
  return {
    id,
    orgId: str(d, 'orgId'),
    clientId: str(d, 'clientId'),
    projectId: str(d, 'projectId'),
    name: str(d, 'name'),
    lines: arr<PackageLine>(d, 'lines'),
    startsOn: toDate(d.startsOn),
    active: bool(d, 'active', true),
  }
}

export function mapRecordingSession(id: string, d: DocData): RecordingSession {
  return {
    id,
    orgId: str(d, 'orgId'),
    clientId: str(d, 'clientId'),
    projectId: str(d, 'projectId'),
    name: str(d, 'name'),
    location: str(d, 'location'),
    date: toDate(d.date),
    startsAt: toDate(d.startsAt),
    endsAt: toDate(d.endsAt),
    taskIds: arr<string>(d, 'taskIds'),
    notes: str(d, 'notes'),
    createdAt: toDate(d.createdAt),
  }
}
