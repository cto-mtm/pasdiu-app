const en = {
  navDashboard: 'Clients',
  navAllTasks: 'Task Queue',
  navSchedule: 'Schedule',
  navAnalytics: 'Analytics',
  navTeam: 'Team',
  navLedger: 'Ledger',
  navSettings: 'Settings',
  navSlate: 'My Slate',
  navPortal: 'Portal',
  localeLabel: 'Language',
  toggleNav: 'Toggle navigation',
  workspaceLabel: 'Workspace',
  // Invitations shown beside the workspace switcher. Shorter than the
  // /welcome copy on purpose — this renders in a ~13rem sidebar column. The
  // decline wording is shared with /welcome (onboarding.decline*) so a
  // terminal action reads identically wherever it is offered.
  invitations: 'Invitations',
  invitationsAria: 'Pending invitations: {count}',
  invitedByShort: 'From {person}',
  invitationJoin: 'Join',
  invitationDeclineFailed: 'Could not decline this invitation. Please try again.',
}

const es: typeof en = {
  navDashboard: 'Clientes',
  navAllTasks: 'Cola de tareas',
  navSchedule: 'Agenda',
  navAnalytics: 'Analíticas',
  navTeam: 'Equipo',
  navLedger: 'Registro',
  navSettings: 'Ajustes',
  navSlate: 'Mi pizarra',
  navPortal: 'Portal',
  localeLabel: 'Idioma',
  toggleNav: 'Alternar navegación',
  workspaceLabel: 'Espacio de trabajo',
  invitations: 'Invitaciones',
  invitationsAria: 'Invitaciones pendientes: {count}',
  invitedByShort: 'De {person}',
  invitationJoin: 'Unirse',
  invitationDeclineFailed: 'No se pudo rechazar la invitación. Inténtalo de nuevo.',
}

export default { en, es }
