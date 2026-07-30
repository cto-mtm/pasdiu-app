import { createI18n } from 'vue-i18n'

// ── Namespace modules ───────────────────────────────────────────
// Each module exports { en, es } and registers under its file-name key.
import common from './locales/configs/common'
import roles from './locales/configs/roles'
import status from './locales/configs/status'
import actions from './locales/configs/actions'
import meta from './locales/configs/meta'
import shell from './locales/components/shell'
import search from './locales/components/search'
import brief from './locales/components/brief'
import batchCreate from './locales/components/batchCreate'
import workflow from './locales/components/workflow'
import packages from './locales/components/packages'
// `import` is a reserved word — alias the binding, keep the registered key.
import importMessages from './locales/components/import'
import tour from './locales/components/tour'
import auth from './locales/pages/auth'
import onboarding from './locales/pages/onboarding'
import invite from './locales/pages/invite'
import dashboard from './locales/pages/dashboard'
import client from './locales/pages/client'
import board from './locales/pages/board'
import calendar from './locales/pages/calendar'
import deliverable from './locales/pages/deliverable'
import iteration from './locales/pages/iteration'
import slate from './locales/pages/slate'
import portal from './locales/pages/portal'
import ledger from './locales/pages/ledger'
import team from './locales/pages/team'
import analytics from './locales/pages/analytics'
import allTasks from './locales/pages/all-tasks'
import settings from './locales/pages/settings'
import billing from './locales/pages/billing'
import pricing from './locales/pages/pricing'
import notFound from './locales/pages/not-found'

export const SUPPORTED_LOCALES = ['en', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

// en is the source of truth; es is typed against it inside each module.
const messages = {
  en: {
    common: common.en,
    roles: roles.en,
    status: status.en,
    actions: actions.en,
    meta: meta.en,
    shell: shell.en,
    search: search.en,
    brief: brief.en,
    batchCreate: batchCreate.en,
    workflow: workflow.en,
    packages: packages.en,
    import: importMessages.en,
    tour: tour.en,
    auth: auth.en,
    onboarding: onboarding.en,
    invite: invite.en,
    dashboard: dashboard.en,
    client: client.en,
    board: board.en,
    calendar: calendar.en,
    deliverableDetail: deliverable.en,
    iteration: iteration.en,
    slate: slate.en,
    portal: portal.en,
    ledger: ledger.en,
    team: team.en,
    analytics: analytics.en,
    allTasks: allTasks.en,
    settings: settings.en,
    billing: billing.en,
    pricing: pricing.en,
    'not-found': notFound.en,
  },
  es: {
    common: common.es,
    roles: roles.es,
    status: status.es,
    actions: actions.es,
    meta: meta.es,
    shell: shell.es,
    search: search.es,
    brief: brief.es,
    batchCreate: batchCreate.es,
    workflow: workflow.es,
    packages: packages.es,
    import: importMessages.es,
    tour: tour.es,
    auth: auth.es,
    onboarding: onboarding.es,
    invite: invite.es,
    dashboard: dashboard.es,
    client: client.es,
    board: board.es,
    calendar: calendar.es,
    deliverableDetail: deliverable.es,
    iteration: iteration.es,
    slate: slate.es,
    portal: portal.es,
    ledger: ledger.es,
    team: team.es,
    analytics: analytics.es,
    allTasks: allTasks.es,
    settings: settings.es,
    billing: billing.es,
    pricing: pricing.es,
    'not-found': notFound.es,
  },
}

const datetimeFormats = {
  en: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
  },
  es: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
  },
} as const

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
  datetimeFormats,
})

// ── Type augmentation ───────────────────────────────────────────
// Makes t('dashboard.title') autocomplete and typecheck against the en schema.
type MessageSchema = typeof messages.en
declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}
