// Suggested metadata field labels, offered as one-click chips in MetaEditor.
// The chosen label is stored as user data (raw string in the current locale).
const en = {
  budget: 'Budget',
  contact: 'Contact',
  email: 'Email',
  phone: 'Phone',
  billing: 'Billing',
  driveFolder: 'Drive folder',
  sopLink: 'SOP link',
  links: 'Links',
  kickoff: 'Kickoff',
  deadline: 'Deadline',
  format: 'Format',
  duration: 'Duration',
  aspectRatio: 'Aspect ratio',
}

// Typed against en: a missing or extra key here is a compile error.
const es: typeof en = {
  budget: 'Presupuesto',
  contact: 'Contacto',
  email: 'Email',
  phone: 'Teléfono',
  billing: 'Facturación',
  driveFolder: 'Carpeta de Drive',
  sopLink: 'Enlace SOP',
  links: 'Enlaces',
  kickoff: 'Inicio',
  deadline: 'Fecha límite',
  format: 'Formato',
  duration: 'Duración',
  aspectRatio: 'Relación de aspecto',
}

export default { en, es }
