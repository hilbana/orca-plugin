// Two languages: English (the default) and Spanish. The panel picks one from Orca's UI language
// (`env.locale`) and tells the worker, so error messages and the status bar use the same one.
// Both run in separate processes, each with its own copy of this module.
export type Lang = 'en' | 'es'

const en = {
  // Connect
  connectTitle: 'Connect to Hilbana',
  connectHelp:
    'Create an API key in Hilbana (read-only is enough to browse) and paste it here. It is stored encrypted in your system keyring, not in this plugin.',
  apiKey: 'API key',
  connect: 'Connect',
  connecting: 'Connecting',
  error: 'Error',
  // Filters
  scopeStarted: 'In progress',
  scopeUnstarted: 'Not started',
  scopeOpen: 'All open',
  scopeAll: 'All (including closed)',
  catTriage: 'Category: Triage',
  catBacklog: 'Category: Backlog',
  catDone: 'Category: Done',
  catCanceled: 'Category: Canceled',
  stateOption: 'State: {name}',
  issues: 'Issues',
  reload: 'Reload',
  disconnect: 'Disconnect',
  workspace: 'Workspace',
  followSwitch: 'Follow the Orca workspace',
  filterProjectsLabel: 'Filter projects',
  filterProjects: 'Filter projects…',
  project: 'Project',
  allProjects: 'All projects',
  state: 'State',
  search: 'Search',
  searchIssues: 'Search issues…',
  searchNotice: 'Results for “{q}” across all states (id, title and text). State filters do not apply.',
  showing: 'Showing {n} of {total}. Narrow it down by project or state.',
  loadingIssues: 'Loading issues',
  noIssues: 'No issues',
  noMatch: 'Nothing matches the filter.',
  rememberedFor: 'Remembered for “{key}”.',
  matchedByName: 'Matched by name: “{key}”.',
  // Detail
  back: 'Back',
  reloadIssue: 'Reload issue',
  agentInProgress: '🤖 In progress: {name}',
  changeState: 'Change state',
  claimNote: 'Moving it to an “in progress” state claims it for your user.',
  release: 'Release',
  claim: 'Claim',
  description: 'Description',
  noDescription: 'No description.',
  related: 'Related',
  mentioned: 'Mentioned',
  comments: 'Comments',
  newComment: 'New comment',
  commentPlaceholder: 'Write a comment… (Ctrl+Enter to send)',
  comment: 'Comment',
  system: 'System',
  relBlocks: 'Blocks',
  relBlockedBy: 'Blocked by',
  relRelates: 'Related',
  // Run in agent
  runInAgent: 'Run in agent',
  runTooltip: "Types the configured prompt (by default the Hilbana plugin command) into the agent's terminal",
  agentLabel: 'Agent',
  noAgent:
    'No agent detected in the focused Orca workspace. Start your agent in a terminal of this workspace (Orca must recognise it as an agent).',
  agentTarget: 'Target: {name}',
  agentBusy: 'The agent is {state}; it can be used once it is idle.',
  sentToAgent: 'Sent to the agent: {text}',
  stWorking: 'working',
  stBlocked: 'blocked',
  stWaiting: 'waiting',
  stDone: 'done',
  // Worker and client messages
  errKeyMissing: 'The Hilbana API key is missing. Connect it from the panel.',
  errReadOnly: 'Your API key is read-only. Create one with write permissions for this action.',
  errCommentEmpty: 'The comment is empty.',
  errBadIdentifier: 'Invalid issue identifier.',
  errAgentGone: 'That agent is no longer in the focused workspace.',
  errAgentBusy: 'The agent is {state}. Wait until it is idle and try again.',
  statusConnect: 'Open the Hilbana panel to connect.',
  statusCount: '{n} issues in progress',
  statusError: 'Error querying Hilbana',
  errUrlInvalid: 'The Hilbana server URL is not valid.',
  errUrlHttps: 'The Hilbana URL must be https:// (http:// is only allowed for localhost).',
  errKeyFormat: 'A Hilbana API key starts with "hil_".',
  errRejected: 'Hilbana rejected the API key (401/403). Check it or create a new one.',
  errHttp: 'Hilbana answered HTTP {status}.',
  errMcp: 'Hilbana: {message}',
  errMcpUnknown: 'MCP error',
  errToolFailed: 'Tool {name} failed.',
  errNotJson: 'Tool {name} did not return JSON.',
  errEmptyMcp: 'Empty MCP response.'
} as const

export type Key = keyof typeof en

const es: Record<Key, string> = {
  connectTitle: 'Conectar con Hilbana',
  connectHelp:
    'Crea una API key en Hilbana (de solo lectura basta para consultar) y pégala aquí. Se guarda cifrada en el keyring de tu sistema, no en este plugin.',
  apiKey: 'API key',
  connect: 'Conectar',
  connecting: 'Conectando',
  error: 'Error',
  scopeStarted: 'En curso',
  scopeUnstarted: 'Sin empezar',
  scopeOpen: 'Todo lo vivo',
  scopeAll: 'Todas (incluidas cerradas)',
  catTriage: 'Categoría: Triage',
  catBacklog: 'Categoría: Backlog',
  catDone: 'Categoría: Hechas',
  catCanceled: 'Categoría: Canceladas',
  stateOption: 'Estado: {name}',
  issues: 'Issues',
  reload: 'Recargar',
  disconnect: 'Desconectar',
  workspace: 'Workspace',
  followSwitch: 'Seguir el workspace de Orca',
  filterProjectsLabel: 'Filtrar proyectos',
  filterProjects: 'Filtrar proyectos…',
  project: 'Proyecto',
  allProjects: 'Todos los proyectos',
  state: 'Estado',
  search: 'Buscar',
  searchIssues: 'Buscar issues…',
  searchNotice: 'Resultados de «{q}» en todos los estados (id, título y texto). Los filtros de estado no se aplican.',
  showing: 'Mostrando {n} de {total}. Afina por proyecto o estado.',
  loadingIssues: 'Cargando issues',
  noIssues: 'Sin issues',
  noMatch: 'Nada coincide con el filtro.',
  rememberedFor: 'Recordado para «{key}».',
  matchedByName: 'Emparejado por nombre: «{key}».',
  back: 'Volver',
  reloadIssue: 'Recargar issue',
  agentInProgress: '🤖 En curso: {name}',
  changeState: 'Cambiar estado',
  claimNote: 'Pasarla a un estado «en curso» la reclama para tu usuario.',
  release: 'Soltar',
  claim: 'Tomar',
  description: 'Descripción',
  noDescription: 'Sin descripción.',
  related: 'Relacionadas',
  mentioned: 'Mencionadas',
  comments: 'Comentarios',
  newComment: 'Nuevo comentario',
  commentPlaceholder: 'Escribe un comentario… (Ctrl+Enter para enviar)',
  comment: 'Comentar',
  system: 'Sistema',
  relBlocks: 'Bloquea',
  relBlockedBy: 'Bloqueada por',
  relRelates: 'Relacionada',
  runInAgent: 'Ejecutar en el agente',
  runTooltip: 'Escribe el prompt configurado (por defecto, el comando del plugin de Hilbana) en la terminal del agente',
  agentLabel: 'Agente',
  noAgent:
    'No se detecta ningún agente en el workspace de Orca en foco. Arranca tu agente en una terminal de este workspace (Orca debe reconocerlo como agente).',
  agentTarget: 'Destino: {name}',
  agentBusy: 'El agente está {state}; se podrá usar cuando esté libre.',
  sentToAgent: 'Enviado al agente: {text}',
  stWorking: 'trabajando',
  stBlocked: 'bloqueado',
  stWaiting: 'esperando',
  stDone: 'terminado',
  errKeyMissing: 'Falta la API key de Hilbana. Conéctala desde el panel.',
  errReadOnly: 'Tu API key es de solo lectura. Crea una con permisos de escritura para esta acción.',
  errCommentEmpty: 'El comentario está vacío.',
  errBadIdentifier: 'Identificador de issue no válido.',
  errAgentGone: 'Ese agente ya no está en el workspace en foco.',
  errAgentBusy: 'El agente está {state}. Espera a que esté libre e inténtalo de nuevo.',
  statusConnect: 'Abre el panel de Hilbana para conectar.',
  statusCount: '{n} issues en curso',
  statusError: 'Error al consultar Hilbana',
  errUrlInvalid: 'La URL del servidor de Hilbana no es válida.',
  errUrlHttps: 'La URL de Hilbana debe ser https:// (http:// solo se admite en localhost).',
  errKeyFormat: 'Una API key de Hilbana empieza por "hil_".',
  errRejected: 'Hilbana rechazó la API key (401/403). Revísala o crea otra.',
  errHttp: 'Hilbana respondió HTTP {status}.',
  errMcp: 'Hilbana: {message}',
  errMcpUnknown: 'Error MCP',
  errToolFailed: 'La tool {name} falló.',
  errNotJson: 'La tool {name} no devolvió JSON.',
  errEmptyMcp: 'Respuesta MCP vacía.'
}

const dictionaries: Record<Lang, Record<Key, string>> = { en, es }
let current: Lang = 'en'

/** 'es', 'es-ES', 'es_MX'… are Spanish; anything else is English. */
export const langOf = (locale: string | undefined | null): Lang => (/^es([-_]|$)/i.test(locale ?? '') ? 'es' : 'en')
export const setLang = (lang: Lang): void => { current = lang }
export const getLang = (): Lang => current

/** The text for `key` in the current language, with `{name}` placeholders filled in. */
export function t(key: Key, params: Record<string, string | number> = {}): string {
  return dictionaries[current][key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

const STATE_KEYS = { working: 'stWorking', blocked: 'stBlocked', waiting: 'stWaiting', done: 'stDone' } as const
/** An Orca agent state ('working', 'blocked', 'waiting', 'done') in the current language. */
export const stateName = (state: string): string =>
  state in STATE_KEYS ? t(STATE_KEYS[state as keyof typeof STATE_KEYS]) : state
