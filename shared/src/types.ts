// Shared Domain model across app, functions, stores, pages, and components.

export type Role = 'admin' | 'pm' | 'contractor' | 'client'

// Every assignable role, for role pickers and iteration.
export const ROLES: readonly Role[] = ['admin', 'pm', 'contractor', 'client']

// Billing tiers. Free is the absence of a subscription.
export type Plan = 'free' | 'studio' | 'agency'

// Stripe subscription lifecycle ('none' = no subscription / free).
export type SubscriptionStatus =
  | 'none'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused'

export interface Org {
  id: string
  name: string
  ownerUid: string
  plan: Plan
  seatLimit: number
  clientLimit: number
  taskLimit: number
  deliverableLimit: number
  subscriptionStatus: SubscriptionStatus
  currentPeriodEnd: Date | null
  pipeline: WorkflowPipeline
}

export interface OrgUsage {
  seats: number
  activeClients: number
  activeTasks: number
  activeDeliverables: number
}

export type BillingInterval = 'month' | 'year'

export interface PlanConfig {
  seatLimit: number
  clientLimit: number
  taskLimit: number
  deliverableLimit: number
  priceMonthly: number
  /** Whole-year total (not a per-month equivalent) — 10 × monthly. */
  priceAnnualTotal: number
}

export interface BillingConfig {
  enabled: boolean
  plans: {
    studio: PlanConfig
    agency: PlanConfig
  }
}

export interface Identity {
  uid: string
  email: string
  displayName: string
}

export interface Membership {
  orgId: string
  orgName: string
  role: Role
  clientId?: string
  title?: string
}

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  role: Role
  clientId?: string
  title?: string
}

export interface Invite {
  id: string
  email: string
  role: Role
  clientId?: string
  // 'declined' = the invitee refused it. Distinct from 'revoked' (the org
  // withdrew it) and from a 'pending' invite nobody has opened, which is the
  // whole point of recording it rather than deleting the doc.
  status: 'pending' | 'accepted' | 'revoked' | 'declined'
  createdAt: Date | null
  invitedBy: string
  locale?: 'en' | 'es'
  // null = no expiry (invites created before expiry existed stay valid).
  expiresAt: Date | null
}

export type TaskStatus =
  | 'backlog'
  | 'in_progress'
  | 'blocked'
  | 'revisions'
  | 'approved'
  | 'delivered'
  | 'done'

export const TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'in_progress',
  'blocked',
  'revisions',
  'approved',
  'delivered',
  'done',
]

export interface MetaField {
  label: string
  value: string
}

export interface Client {
  id: string
  orgId: string
  name: string
  meta: MetaField[]
}

export interface ProjectBrief {
  brandGuidelinesUrl: string
  sopUrl: string
  links: string[]
  fields: MetaField[]
}

export interface Project {
  id: string
  orgId: string
  clientId: string
  name: string
  defaultView: 'kanban' | 'list' | 'deliverables'
  brief: ProjectBrief
  meta: MetaField[]
}

export interface SubGroup {
  id: string
  orgId: string
  projectId: string
  name: string
  order: number
  meta: MetaField[]
}

export interface Task {
  id: string
  orgId: string
  title: string
  description: string
  subGroupId: string
  projectId: string
  clientId: string
  status: TaskStatus
  assigneeUid: string
  clientVisible: boolean
  blockedReason: string
  blockedAt: Date | null
  deliveryNote: string
  meta: MetaField[]
  order: number
  dueAt: Date | null
  createdAt: Date | null
  completedAt: Date | null
  deliverableId: string
  stageId: string
}

export interface Version {
  id: string
  label: string
  note: string
  createdAt: Date | null
  mediaUrl: string
}

export interface Note {
  id: string
  versionId: string
  authorUid: string
  body: string
  resolved: boolean
  createdAt: Date | null
}

// ── Deliverables & Workflow ──────────────────────────────────────────────────

export interface WorkflowStage {
  id: string
  name: string
  optional: boolean
  clientFacing: boolean
  // How long this stage takes, in whole hours. Stage due dates are derived by
  // chaining these along the pipeline from the deliverable's anchor date (see
  // the batch endpoint's scheduleMode). 0 = unset: the stage consumes no time,
  // so every task falls on the anchor date — the behaviour before durations
  // existed, which is what pipelines predating this field still get.
  durationHours: number
}

export interface WorkflowPipeline {
  stages: WorkflowStage[]
}

export interface DeliverableType {
  id: string
  orgId: string
  name: string
  weight: number
  order: number
}

export type DeliverableStatus = 'active' | 'delivered' | 'canceled'

// What gets worked on first. Ordered most- to least-urgent so a sort can index
// into it directly; 'normal' is the default every existing deliverable reads as.
export type DeliverablePriority = 'high' | 'normal' | 'low'

export const DELIVERABLE_PRIORITIES: DeliverablePriority[] = ['high', 'normal', 'low']

/** Sort rank — lower sorts first. */
export function priorityRank(p: DeliverablePriority): number {
  return DELIVERABLE_PRIORITIES.indexOf(p)
}

export interface StageSummaryEntry {
  stageId: string
  name: string
  status: TaskStatus
  assigneeUid: string
  assigneeName: string
  dueAt: Date | null
  taskId: string // '' when the stage's task doesn't exist yet
  clientVisible: boolean // mirrors the task; lets the portal link chips without a task query
}

export type ApprovalVia = 'portal' | 'in_person' | 'external'

export type PackagePeriod = 'month' | 'quarter' | 'once'

export interface PackageLine {
  typeId: string
  quantity: number
  period: PackagePeriod
}

export interface Package {
  id: string
  orgId: string
  clientId: string
  projectId: string
  name: string
  lines: PackageLine[]
  startsOn: Date | null
  active: boolean
}

export interface RecordingSession {
  id: string
  orgId: string
  clientId: string
  projectId: string
  name: string
  location: string
  date: Date | null
  startsAt: Date | null
  endsAt: Date | null
  taskIds: string[]
  notes: string
  createdAt: Date | null
}

export interface Deliverable {
  id: string
  orgId: string
  clientId: string
  projectId: string
  subGroupId: string
  subGroupName: string
  typeId: string
  stages: WorkflowStage[]
  stageSummary: StageSummaryEntry[]
  name: string
  status: DeliverableStatus
  priority: DeliverablePriority
  clientVisible: boolean
  latestVersionUrl: string
  latestVersionLabel: string
  order: number
  meta: MetaField[]
  createdAt: Date | null
  deliveredAt: Date | null
  approvedBy: string
  approvedVia: ApprovalVia | ''
  approvedAt: Date | null
  approvalNote: string
}
