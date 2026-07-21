import { z } from 'zod'

export const RoleSchema = z.enum(['admin', 'pm', 'contractor', 'client'])

export const PlanSchema = z.enum(['free', 'studio', 'agency'])

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
})

export const InviteUserSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
  clientId: z.string().optional(),
})

export const AcceptInviteSchema = z.object({
  inviteId: z.string().min(1),
})

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>
export type InviteUserInput = z.infer<typeof InviteUserSchema>
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>
