// Pure Firestore-doc → domain-model converters. Deliberately NO firebase
// imports — the SDK stays confined to the stores (per CLAUDE.md), so these
// take plain `(id, data)` pairs and are trivially unit-testable.
//
// Normalizers — seed/older docs may lack meta/brief fields, so default them.
import { FREE_LIMITS } from './plans'
import type {
  Client, Deliverable, DeliverableStatus, DeliverableType, Invite, Membership, MetaField, Note, Org, OrgUsage, Package, PackageLine, Plan, Project, Role, StageSummaryEntry, SubGroup, SubscriptionStatus,
  Task, TaskStatus, UserProfile, Version, WorkflowPipeline, WorkflowStage,
} from './types'

// Firestore Timestamp | null → JS Date | null. Duck-typed so we don't need
// the SDK's Timestamp class: anything exposing toDate() converts, everything
// else (null, undefined, plain values) maps to null.
function toDate(v: unknown): Date | null {
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

export function mapClient(id: string, d: Record<string, unknown>): Client {
  return { id, orgId: d.orgId as string, name: d.name as string, meta: (d.meta as MetaField[]) ?? [] }
}

export function mapSubGroup(id: string, d: Record<string, unknown>): SubGroup {
  return {
    id,
    orgId: d.orgId as string,
    projectId: d.projectId as string,
    name: d.name as string,
    order: (d.order as number) ?? 0,
    meta: (d.meta as MetaField[]) ?? [],
  }
}

export function mapProject(id: string, d: Record<string, unknown>): Project {
  const b = (d.brief as Record<string, unknown>) ?? {}
  return {
    id,
    orgId: d.orgId as string,
    clientId: d.clientId as string,
    name: d.name as string,
    defaultView: (d.defaultView as 'kanban' | 'list') ?? 'kanban',
    brief: {
      brandGuidelinesUrl: (b.brandGuidelinesUrl as string) ?? '',
      sopUrl: (b.sopUrl as string) ?? '',
      links: (b.links as string[]) ?? [],
      fields: (b.fields as MetaField[]) ?? [],
    },
    meta: (d.meta as MetaField[]) ?? [],
  }
}

export function mapTask(id: string, d: Record<string, unknown>): Task {
  return {
    id,
    orgId: d.orgId as string,
    title: d.title as string,
    description: (d.description as string) ?? '',
    subGroupId: d.subGroupId as string,
    projectId: d.projectId as string,
    clientId: d.clientId as string,
    status: d.status as TaskStatus,
    assigneeUid: d.assigneeUid as string,
    clientVisible: (d.clientVisible as boolean) ?? false, // legacy docs: hidden
    blockedReason: (d.blockedReason as string) ?? '',
    blockedAt: toDate(d.blockedAt),
    deliveryNote: (d.deliveryNote as string) ?? '',
    meta: (d.meta as MetaField[]) ?? [],
    order: (d.order as number) ?? 0,
    dueAt: toDate(d.dueAt),
    createdAt: toDate(d.createdAt),
    completedAt: toDate(d.completedAt),
    deliverableId: (d.deliverableId as string) ?? '',
    stageId: (d.stageId as string) ?? '',
  }
}

export function mapVersion(id: string, d: Record<string, unknown>): Version {
  return {
    id,
    label: d.label as string,
    note: d.note as string,
    createdAt: toDate(d.createdAt),
    mediaUrl: d.mediaUrl as string,
  }
}

// orgs/{orgId} — the workspace doc. Billing fields are function-written; docs
// that predate billing may lack them, so default to the Free shape.
export function mapOrg(id: string, d: Record<string, unknown>): Org {
  return {
    id,
    name: d.name as string,
    ownerUid: d.ownerUid as string,
    plan: (d.plan as Plan) ?? 'free',
    // Missing limits default to the FREE tier's numbers (never 0 — a 0
    // limit would hard-block every create with "0-client limit" copy).
    seatLimit: (d.seatLimit as number) ?? FREE_LIMITS.seatLimit,
    clientLimit: (d.clientLimit as number) ?? FREE_LIMITS.clientLimit,
    taskLimit: (d.taskLimit as number) ?? FREE_LIMITS.taskLimit,
    deliverableLimit: (d.deliverableLimit as number) ?? FREE_LIMITS.deliverableLimit,
    subscriptionStatus: (d.subscriptionStatus as SubscriptionStatus) ?? 'none',
    currentPeriodEnd: toDate(d.currentPeriodEnd),
    pipeline: (d.pipeline as WorkflowPipeline) ?? { stages: [] },
  }
}

// orgs/{orgId}/usage/current — counter doc for entitlement gates. Missing
// fields default to 0 (a fresh doc counts nothing).
export function mapUsage(d: Record<string, unknown>): OrgUsage {
  return {
    seats: (d.seats as number) ?? 0,
    activeClients: (d.activeClients as number) ?? 0,
    activeTasks: (d.activeTasks as number) ?? 0,
    activeDeliverables: (d.activeDeliverables as number) ?? 0,
  }
}

// orgs/{orgId}/members/{uid} doc → the roster shape pages consume. The doc id
// IS the member's uid.
export function mapMember(id: string, d: Record<string, unknown>): UserProfile {
  return {
    uid: id,
    displayName: d.displayName as string,
    email: d.email as string,
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
  }
}

// Same doc, viewed from the account's side: one org membership (collection-
// group query result). orgName is denormalized onto the member doc.
export function mapMembership(d: Record<string, unknown>): Membership {
  return {
    orgId: d.orgId as string,
    orgName: (d.orgName as string) ?? '',
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
  }
}

// orgs/{orgId}/invites/{inviteId} — a workspace invitation.
export function mapInvite(id: string, d: Record<string, unknown>): Invite {
  return {
    id,
    email: d.email as string,
    role: d.role as Role,
    clientId: d.clientId as string | undefined,
    status: d.status as Invite['status'],
    createdAt: toDate(d.createdAt),
    invitedBy: d.invitedBy as string,
    locale: d.locale as Invite['locale'],
    expiresAt: toDate(d.expiresAt), // null = legacy invite without expiry
  }
}

export function mapNote(id: string, d: Record<string, unknown>): Note {
  return {
    id,
    versionId: d.versionId as string,
    authorUid: d.authorUid as string,
    body: d.body as string,
    resolved: (d.resolved as boolean) ?? false,
    createdAt: toDate(d.createdAt),
  }
}

export function mapDeliverable(id: string, d: Record<string, unknown>): Deliverable {
  return {
    id,
    orgId: d.orgId as string,
    clientId: d.clientId as string,
    projectId: d.projectId as string,
    subGroupId: d.subGroupId as string,
    subGroupName: (d.subGroupName as string) ?? '',
    typeId: (d.typeId as string) ?? '',
    stages: (d.stages as WorkflowStage[]) ?? [],
    stageSummary: (d.stageSummary as StageSummaryEntry[]) ?? [],
    name: d.name as string,
    status: (d.status as DeliverableStatus) ?? 'active',
    clientVisible: (d.clientVisible as boolean) ?? false,
    latestVersionUrl: (d.latestVersionUrl as string) ?? '',
    order: (d.order as number) ?? 0,
    meta: (d.meta as MetaField[]) ?? [],
    createdAt: toDate(d.createdAt),
    deliveredAt: toDate(d.deliveredAt),
    approvedBy: (d.approvedBy as string) ?? '',
    approvedVia: (d.approvedVia as Deliverable['approvedVia']) ?? '',
    approvedAt: toDate(d.approvedAt),
    approvalNote: (d.approvalNote as string) ?? '',
  }
}

export function mapDeliverableType(id: string, d: Record<string, unknown>): DeliverableType {
  return {
    id,
    orgId: d.orgId as string,
    name: d.name as string,
    weight: (d.weight as number) ?? 1,
    order: (d.order as number) ?? 0,
  }
}

export function mapPackage(id: string, d: Record<string, unknown>): Package {
  return {
    id,
    orgId: d.orgId as string,
    clientId: d.clientId as string,
    projectId: d.projectId as string,
    name: d.name as string,
    lines: (d.lines as PackageLine[]) ?? [],
    startsOn: toDate(d.startsOn),
    active: (d.active as boolean) ?? true,
  }
}
