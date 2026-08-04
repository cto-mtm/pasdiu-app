const en = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  revisions: 'Revisions',
  approved: 'Approved',
  delivered: 'Delivered',
  done: 'Done',
  // Not a status — the board column that folds the three the client flow
  // writes (revisions / approved / delivered) into one place.
  review: 'In Review',
}

const es: typeof en = {
  backlog: 'Pendiente',
  in_progress: 'En progreso',
  blocked: 'Bloqueado',
  revisions: 'Revisiones',
  approved: 'Aprobado',
  delivered: 'Entregado',
  done: 'Terminado',
  review: 'En revisión',
}

export default { en, es }
