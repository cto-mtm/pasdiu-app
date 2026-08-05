// Billing card on Settings (plan, upgrade, Stripe portal). The $ formatting
// lives inside the messages so each locale controls its own currency layout.
const en = {
  title: 'Billing',
  notConfigured: "Billing isn't configured in this environment.",
  currentPlan: 'Current plan',
  planFree: 'Free',
  planStudio: 'Studio',
  planAgency: 'Agency',
  statusPastDue: 'Payment past due — update your payment method to keep your plan.',
  statusCanceled: 'Subscription canceled — your workspace moves to the Free plan at the end of the billing period.',
  renewsOn: 'Renews on {date}',
  intervalMonthly: 'Monthly',
  intervalAnnual: 'Annual',
  upgradeCta: '{plan} — ${price}/mo',
  billedAnnually: 'Billed annually.',
  manage: 'Manage billing',
  checkoutSuccess: 'Payment successful — your plan is being updated.',
  // 503 price_unavailable: the plan has no price in the Stripe catalog, so
  // there is nothing for the customer to retry. Distinct from a generic
  // failure so support hears "this plan" instead of "checkout is broken".
  checkoutUnavailable: "This plan can't be purchased right now. Please contact support.",
  // Entitlement gates: shown by UpsellModal when a create/invite hits a plan
  // limit, parameterized by the gate that fired.
  upsellTitle: 'Upgrade your plan',
  gateClients: "You've reached the {limit}-client limit on your plan. Upgrade to add more clients.",
  gateTasks: "You've reached the {limit}-task limit on your plan. Upgrade to add more tasks.",
  gateSeats: "You've reached the {limit}-seat limit on your plan. Upgrade to invite more people.",
  gateFeature: "This feature isn't included in your current plan.",
  askAdmin: 'Ask your workspace admin to upgrade the plan.',
  seePlans: 'See plans',
  seeAllPlans: 'See all plans',
  // Usage bars on the Settings billing card.
  usageSeats: 'Seats',
  usageClients: 'Active clients',
  usageTasks: 'Active tasks',
  usageOf: '{used} of {limit}',
  usageUnlimited: '{used} · unlimited',
  // Feature locks (paid-plan features hidden on Free).
  importLocked: 'CSV import is available on the Studio and Agency plans.',
  csvExportLocked: 'CSV export is available on the Studio and Agency plans.',
}

// Typed against en: a missing or extra key here is a compile error.
const es: typeof en = {
  title: 'Facturación',
  notConfigured: 'La facturación no está configurada en este entorno.',
  currentPlan: 'Plan actual',
  planFree: 'Gratis',
  planStudio: 'Studio',
  planAgency: 'Agency',
  statusPastDue: 'Pago vencido: actualiza tu método de pago para conservar tu plan.',
  statusCanceled: 'Suscripción cancelada: tu espacio de trabajo pasará al plan Gratis al final del período de facturación.',
  renewsOn: 'Se renueva el {date}',
  intervalMonthly: 'Mensual',
  intervalAnnual: 'Anual',
  upgradeCta: '{plan} — {price} US$/mes',
  billedAnnually: 'Con facturación anual.',
  manage: 'Gestionar facturación',
  checkoutSuccess: 'Pago realizado: tu plan se está actualizando.',
  checkoutUnavailable: 'Este plan no se puede contratar en este momento. Contacta con soporte.',
  upsellTitle: 'Mejora tu plan',
  gateClients: 'Has alcanzado el límite de {limit} clientes de tu plan. Mejora tu plan para añadir más clientes.',
  gateTasks: 'Has alcanzado el límite de {limit} tareas de tu plan. Mejora tu plan para añadir más tareas.',
  gateSeats: 'Has alcanzado el límite de {limit} puestos de tu plan. Mejora tu plan para invitar a más personas.',
  gateFeature: 'Esta función no está incluida en tu plan actual.',
  askAdmin: 'Pide al administrador de tu espacio de trabajo que mejore el plan.',
  seePlans: 'Ver planes',
  seeAllPlans: 'Ver todos los planes',
  usageSeats: 'Puestos',
  usageClients: 'Clientes activos',
  usageTasks: 'Tareas activas',
  usageOf: '{used} de {limit}',
  usageUnlimited: '{used} · sin límite',
  importLocked: 'La importación CSV está disponible en los planes Studio y Agency.',
  csvExportLocked: 'La exportación CSV está disponible en los planes Studio y Agency.',
}

export default { en, es }
