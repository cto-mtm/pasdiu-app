const en = {
  appName: 'Pasdiu',
  loading: 'Loading…',
  retry: 'Retry',
  close: 'Close',
  saveError: "Couldn't save. Please try again.",
  loadError: "Couldn't load data.",
  notFound: 'Not found',
  userFallback: 'User',
  apiErrorRequest: 'Request failed ({status})',
  apiErrorNetwork: 'Network error',
  moreActions: 'More actions',
  invalidName: 'Name must be between 1 and 60 characters.',
  renameCooldown: 'Please wait a few seconds before renaming again.',
  orgNotFound: 'Workspace not found.',
}

// Typed against en: a missing or extra key here is a compile error.
const es: typeof en = {
  appName: 'Pasdiu',
  loading: 'Cargando…',
  retry: 'Reintentar',
  close: 'Cerrar',
  saveError: 'No se pudo guardar. Inténtalo de nuevo.',
  loadError: 'No se pudieron cargar los datos.',
  notFound: 'No encontrado',
  userFallback: 'Usuario',
  apiErrorRequest: 'Error de solicitud ({status})',
  apiErrorNetwork: 'Error de red',
  moreActions: 'Más acciones',
  invalidName: 'El nombre debe tener entre 1 y 60 caracteres.',
  renameCooldown: 'Espera unos segundos antes de renombrar de nuevo.',
  orgNotFound: 'Espacio de trabajo no encontrado.',
}

export default { en, es }
