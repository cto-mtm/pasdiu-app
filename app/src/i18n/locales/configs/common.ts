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
}

export default { en, es }
