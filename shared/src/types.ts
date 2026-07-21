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
  subscriptionStatus: SubscriptionStatus
  currentPeriodEnd: Date | null
}

export interface OrgUsage {
  seats: number
  activeClients: number
  activeTasks: number
}

export type BillingInterval = 'month' | 'year'

export interface PlanConfig {
  seatLimit: number
  clientLimit: number
  taskLimit: number
  priceMonthly: number
  priceAnnual: number
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
}

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  role: Role
  clientId?: string
}

export interface Invite {
  id: string
  email: string
  role: Role
  clientId?: string
  status: 'pending' | 'accepted' | 'revoked'
  createdAt: Date | null
  invitedBy: string
  locale?: 'en' | 'es'
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
  defaultView: 'kanban' | 'list'
  brief: ProjectBrief
  meta: MetaField[]
}

export interface SubGroup {
  id: string
  orgId: string
  projectId: string
  name: string
  order: number
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
