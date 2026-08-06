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
import schedule from './locales/pages/schedule'
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

// ── Module registry ─────────────────────────────────────────────
// Adding a new i18n module = one line here. Both en and es are built
// automatically from this registry — no duplicate assembly block.
const modules = {
  common, roles, status, actions, meta,
  shell, search, brief, batchCreate, workflow, packages,
  import: importMessages, tour,
  auth, onboarding, invite, dashboard, client, board, calendar,
  deliverableDetail: deliverable, iteration, slate, schedule,
  portal, ledger, team, analytics, allTasks, settings, billing, pricing,
  'not-found': notFound,
} as const

type ModuleKey = keyof typeof modules

// en is the source of truth; es is typed against it inside each module.
const messages = {
  en: Object.fromEntries(
    Object.entries(modules).map(([k, m]) => [k, m.en]),
  ) as { [K in ModuleKey]: (typeof modules)[K]['en'] },
  es: Object.fromEntries(
    Object.entries(modules).map(([k, m]) => [k, m.es]),
  ) as { [K in ModuleKey]: (typeof modules)[K]['es'] },
}

// Datetime formats — identical across locales for now. When Spanish needs a
// divergent format, override just that key in the es spread.
const baseDatetimeFormats = {
  short: { year: 'numeric', month: 'short', day: 'numeric' },
  monthYear: { year: 'numeric', month: 'long' },
  weekday: { weekday: 'long', month: 'long', day: 'numeric' },
} as const

const datetimeFormats = {
  en: baseDatetimeFormats,
  es: baseDatetimeFormats,
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
