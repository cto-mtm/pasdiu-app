const en = {
  admin: 'Admin',
  pm: 'Project Manager',
  contractor: 'Crew', // Intentionally untranslated — production industry term
  client: 'Client',
}

const es: typeof en = {
  admin: 'Administrador',
  pm: 'Gestor de proyecto',
  contractor: 'Crew', // Kept in English — universal in video/film production
  client: 'Cliente',
}

export default { en, es }
