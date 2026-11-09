// Worker of the Hilbana plugin. It is the only part that talks to the network: the panel
// lives in a frame with no network access. The API key lives in Orca's keyring (secrets:own),
// never in the repo, in settings or in storage.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentInfo, IssueDetail, IssuePage, IssueRef, IssueRow, Relation, WorkflowState } from './protocol'
import { getLang, langOf, setLang, stateName, t } from './i18n'
import { bestProjectByName, exactIdentifier, matchesLocally } from './match'
import {
  callTool,
  DEFAULT_URL,
  validateKey,
  validateUrl,
  type Issue,
  type Project,
  type Workspace
} from './hilbana'

const KEY = 'apiKey'
/** `{identifier}` is replaced by the issue identifier (DRAPPS-123). Editable in the plugin settings. */
const DEFAULT_PROMPT = '/hilbana:trabajar-issue {identifier}'
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/
// The panel<->worker bridge allows 1 MiB per reply: rows are capped before reaching it.
const MAX_ROWS = 1000
const POLL_MS = 2 * 60_000
let timer: ReturnType<typeof setInterval> | undefined

const toRow = (issue: Issue): IssueRow => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  state: issue.state,
  stateType: issue.stateType,
  project: issue.project,
  projectId: issue.projectId ?? null,
  assignee: issue.assignee,
  priority: issue.priority ?? null,
  agentWorking: issue.agentWorking ?? null,
  labels: (issue.labels ?? []).map((label) => label.name)
})

export default function activate(orca: OrcaWorkerApi): void {
  const serverUrl = async (): Promise<string> => {
    const value = (await orca.settings.get('serverUrl')) as unknown
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_URL
  }
  const apiKey = async (): Promise<string> => {
    const key = await orca.secrets.get(KEY)
    if (!key) throw new Error(t('errKeyMissing'))
    return key
  }
  const call = async <T>(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
    callTool<T>(await serverUrl(), await apiKey(), name, args, signal)

  const withWs = (workspaceId?: string) => (workspaceId ? { workspaceId } : {})

  async function refreshStatusBar(): Promise<void> {
    try {
      if (!(await orca.secrets.get(KEY))) {
        await orca.host.call('statusBar.update', {
          id: 'queue', text: 'Hilbana —', tone: 'neutral', tooltip: t('statusConnect')
        })
        return
      }
      const started = await call<Issue[]>('list_issues', { stateCategory: 'started' })
      await orca.host.call('statusBar.update', {
        id: 'queue',
        text: `Hilbana ${started.length}`,
        tone: 'neutral',
        tooltip: t('statusCount', { n: started.length })
      })
    } catch (error) {
      await orca.host
        .call('statusBar.update', {
          id: 'queue', text: 'Hilbana ✕', tone: 'warning',
          tooltip: error instanceof Error ? error.message : t('statusError')
        })
        .catch(() => undefined)
    }
  }

  orca.panels.handle('locale.set', async ({ locale }) => {
    const lang = langOf(locale)
    if (lang !== getLang()) {
      setLang(lang)
      void refreshStatusBar()
    }
    await orca.storage.set('lang', lang) // remembered for the status bar after a restart
    return { ok: true as const }
  })

  orca.panels.handle('auth.status', async () => ({
    connected: Boolean(await orca.secrets.get(KEY)),
    url: await serverUrl(),
    protection: (await orca.host.call('secrets.protection')).status
  }))

  orca.panels.handle('auth.save', async ({ key }) => {
    const clean = validateKey(key)
    validateUrl(await serverUrl())
    // Validated BEFORE saving: a bad key never reaches the keyring.
    const workspaces = await callTool<Workspace[]>(await serverUrl(), clean, 'list_workspaces')
    await orca.secrets.set(KEY, clean)
    orca.panels.post('auth.changed', { connected: true })
    void refreshStatusBar()
    return { workspaces: workspaces.length }
  })

  orca.panels.handle('auth.clear', async () => {
    await orca.secrets.delete(KEY)
    orca.panels.post('auth.changed', { connected: false })
    void refreshStatusBar()
    return { ok: true as const }
  })

  orca.panels.handle('workspaces.list', async (_input, { signal }) =>
    (await call<Workspace[]>('list_workspaces', {}, signal)).map(({ id, name, default: d }) => ({
      id, name, default: d
    }))
  )

  orca.panels.handle('projects.list', async ({ workspaceId }, { signal }) =>
    (await call<Project[]>('list_projects', withWs(workspaceId), signal)).map(({ id, name }) => ({
      id, name
    }))
  )

  orca.panels.handle('issues.list', async ({ workspaceId, projectId, scope, query }, { signal }): Promise<IssuePage> => {
    if (query?.trim()) return searchIssues(query.trim(), workspaceId, projectId, signal)
    const args: Record<string, unknown> = { ...withWs(workspaceId) }
    if (projectId) args.projectId = projectId
    // 'open' = Hilbana's default (everything alive); 'all' and specific states also need
    // the closed ones; the rest filter by category on the server.
    let byName: string | null = null
    if (scope === 'all') args.includeClosed = true
    else if (scope.startsWith('state:')) { args.includeClosed = true; byName = scope.slice(6) }
    else if (scope !== 'open') args.stateCategory = scope
    let issues = await call<Issue[]>('list_issues', args, signal)
    if (byName !== null) issues = issues.filter((issue) => issue.state === byName)
    return { rows: issues.slice(0, MAX_ROWS).map(toRow), total: issues.length }
  })

  // In-memory index of ALL the workspace's issues (any state): it allows local matching by
  // identifier/title without going through the bridge's 1 MiB limit.
  const INDEX_TTL = 2 * 60_000
  const indexes = new Map<string, { at: number; issues: Issue[] }>()
  async function issueIndex(workspaceId: string | undefined, signal?: AbortSignal): Promise<Issue[]> {
    const key = workspaceId ?? ''
    const hit = indexes.get(key)
    if (hit && Date.now() - hit.at < INDEX_TTL) return hit.issues
    const issues = await call<Issue[]>('list_issues', { includeClosed: true, ...withWs(workspaceId) }, signal)
    indexes.set(key, { at: Date.now(), issues })
    return issues
  }

  /** Like the web app: local match (id/title) ∪ server full-text, across all states. */
  async function searchIssues(query: string, workspaceId?: string, projectId?: string, signal?: AbortSignal): Promise<IssuePage> {
    const [index, server] = await Promise.all([
      issueIndex(workspaceId, signal).catch(() => [] as Issue[]),
      // If the full-text search fails, the local match still works.
      call<Issue[]>('search_issues', { query, limit: 100, ...withWs(workspaceId) }, signal).catch(() => [] as Issue[])
    ])
    const local = index.filter((issue) => matchesLocally(issue, query))
    const seen = new Set<string>()
    const merged: Issue[] = []
    const add = (issue: Issue) => {
      if (seen.has(issue.id) || (projectId && issue.projectId !== projectId)) return
      seen.add(issue.id)
      merged.push(issue)
    }
    // Exact identifier first, then the server's ranking, then the remaining local matches.
    local.filter((issue) => exactIdentifier(issue.identifier, query)).forEach(add)
    server.forEach(add)
    local.forEach(add)
    return { rows: merged.slice(0, MAX_ROWS).map(toRow), total: merged.length }
  }

  type Full = Issue & {
    description?: string | null
    stateId?: string | null
    teamId?: string | null
    relations?: { type: string; issueId: string | null; issue: string; title: string | null; state: string }[]
    comments?: { id: string; author: string | null; body: string; createdAt: string | number }[]
  }
  const toDetail = (i: Full): IssueDetail => ({
    ...toRow(i),
    description: i.description ?? '',
    stateId: i.stateId ?? null,
    teamId: i.teamId ?? null,
    relations: (i.relations ?? []).map((r): Relation => ({ type: r.type, issueId: r.issueId, identifier: r.issue, title: r.title, state: r.state })),
    comments: (i.comments ?? []).map(({ id, author, body, createdAt }) => ({ id, author, body, createdAt }))
  })
  const getDetail = async (id: string, signal?: AbortSignal) =>
    toDetail(await call<Full>('get_issue', { id }, signal))

  /** A read-only key has no write tools registered: say so clearly. */
  async function write(name: string, args: Record<string, unknown>): Promise<void> {
    try {
      await call(name, args)
      indexes.clear() // state, lock and comments change what the index shows
    } catch (error) {
      const text = error instanceof Error ? error.message : ''
      if (text.includes(name) && /not found|unknown|no such/i.test(text)) {
        throw new Error(t('errReadOnly'))
      }
      throw error
    }
  }

  const LINKS = 'workspaceLinks'
  type Link = { projectId?: string; workspaceId?: string }
  const readLinks = async (): Promise<Record<string, Link>> => {
    const value = (await orca.storage.get(LINKS)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    // Links saved by earlier versions were just the project id.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        typeof entry === 'string' ? { projectId: entry } : ((entry ?? {}) as Link)
      ])
    )
  }

  // Which Hilbana workspace/project/issue an Orca workspace corresponds to, from most to least precise.
  orca.panels.handle('workspace.resolve', async ({ displayName, branch, workspaceId }, { signal }) => {
    // The Orca project (repo) is a steadier key than a worktree's name, when Orca gives one.
    const entries = (await orca.host.call('workspace.list')).workspaces.filter((w) => w.name === displayName)
    const entry = entries.length === 1 ? entries[0]! : null
    const orcaProject = (entry as { project?: string | null } | null)?.project
    const key = (orcaProject || displayName).trim()

    // A remembered Hilbana workspace scopes every lookup below; otherwise the panel's current one does.
    const link = (await readLinks())[key]
    const linkedWorkspace = link?.workspaceId || null
    const scopeWorkspace = linkedWorkspace ?? workspaceId
    const answer = (projectId: string | null, source: 'branch' | 'link' | 'name' | null, issue: { id: string; identifier: string } | null) =>
      ({ key, workspaceId: linkedWorkspace, projectId, source, issue })

    // 1) Branch convention `<team>-<n>-<slug>` (e.g. drapps-2139-search): the issue's own project.
    const match = /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/i.exec(branch.trim().replace(/^[^/]*\//, '').trim())
    if (match) {
      const identifier = `${match[1]!.toUpperCase()}-${Number(match[2])}`
      const issue = (await issueIndex(scopeWorkspace, signal)).find((candidate) => candidate.identifier === identifier)
      if (issue) return answer(issue.projectId ?? null, 'branch', { id: issue.id, identifier })
    }

    const projects = await call<Project[]>('list_projects', withWs(scopeWorkspace), signal)
    const exists = (id: string | undefined) => (id && projects.some((project) => project.id === id) ? id : null)

    // 2) A link learned from you (a link to a deleted project is ignored).
    const linked = exists(link?.projectId)
    if (linked) return answer(linked, 'link', null)

    // 3) Name match: the workspace name or its folder name against the project names.
    const folder = entry?.path.split(/[\\/]/).filter(Boolean).pop()
    const named = bestProjectByName([displayName, ...(folder ? [folder] : [])], projects)
    return named ? answer(named, 'name', null) : answer(null, linkedWorkspace ? 'link' : null, null)
  })

  orca.panels.handle('workspace.link', async ({ key, projectId, workspaceId }) => {
    const links = await readLinks()
    if (projectId || workspaceId) {
      links[key] = { ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}) }
    } else {
      delete links[key]
    }
    await orca.storage.set(LINKS, links)
    return { ok: true as const }
  })

  orca.panels.handle('issues.resolve', async ({ identifiers, workspaceId }, { signal }): Promise<IssueRef[]> => {
    const wanted = new Set(identifiers.slice(0, 200).map((id) => id.toUpperCase()))
    if (wanted.size === 0) return []
    return (await issueIndex(workspaceId, signal))
      .filter((issue) => wanted.has(issue.identifier))
      .map(({ id, identifier, title, state }) => ({ id, identifier, title, state }))
  })

  const listAgents = async (): Promise<AgentInfo[]> =>
    (await orca.host.call('agents.list')).agents.flatMap((agent) =>
      agent.terminalId
        ? [{ terminalId: agent.terminalId, title: agent.title, agent: agent.agent, state: agent.state }]
        : []
    )

  orca.panels.handle('agents.list', () => listAgents())

  orca.panels.handle('agent.send', async ({ terminalId, identifier }) => {
    // The identifier is the only thing interpolated into the prompt: keep it strict.
    if (!IDENTIFIER.test(identifier)) throw new Error(t('errBadIdentifier'))
    // Re-checked right before sending: an agent that started working meanwhile must not be interrupted.
    const target = (await listAgents()).find((agent) => agent.terminalId === terminalId)
    if (!target) throw new Error(t('errAgentGone'))
    if (target.state === 'working' || target.state === 'blocked') {
      throw new Error(t('errAgentBusy', { state: stateName(target.state) }))
    }
    const configured = (await orca.settings.get('agentPrompt')) as unknown
    const template = typeof configured === 'string' && configured.trim() ? configured : DEFAULT_PROMPT
    // One line only: a newline would submit several prompts.
    const text = template.replaceAll('{identifier}', identifier).replace(/[\r\n]+/g, ' ').trim()
    await orca.host.call('terminal.sendText', { terminalId, text, enter: true })
    return { sent: text }
  })

  orca.panels.handle('issue.get', ({ id }, { signal }) => getDetail(id, signal))

  orca.panels.handle('states.list', async ({ workspaceId, teamId }, { signal }) => {
    const all = await call<(WorkflowState & { teamId: string })[]>('list_workflow_states', withWs(workspaceId), signal)
    const seen = new Set<string>()
    return all
      .filter((state) => (teamId ? state.teamId === teamId : !seen.has(state.name) && seen.add(state.name)))
      .map(({ id, name, type }) => ({ id, name, type }))
  })

  orca.panels.handle('issue.setState', async ({ id, stateId }) => {
    await write('change_issue_state', { id, stateId })
    void refreshStatusBar()
    return getDetail(id)
  })
  orca.panels.handle('issue.claim', async ({ id }) => {
    await write('claim_issue', { id })
    void refreshStatusBar()
    return getDetail(id)
  })
  orca.panels.handle('issue.release', async ({ id }) => {
    await write('release_issue', { id })
    void refreshStatusBar()
    return getDetail(id)
  })
  orca.panels.handle('issue.comment', async ({ id, body }) => {
    if (!body.trim()) throw new Error(t('errCommentEmpty'))
    await write('add_comment', { issueId: id, body })
    return getDetail(id)
  })

  // Keeps the status bar counter fresh even when the panel is closed.
  void Promise.resolve(orca.storage.get('lang'))
    .then((stored) => { if (stored === 'es' || stored === 'en') setLang(stored) })
    .catch(() => undefined)
    .then(() => refreshStatusBar())
  timer = setInterval(() => void refreshStatusBar(), POLL_MS)
  orca.log('Hilbana plugin active')
}

export function deactivate(): void {
  if (timer) clearInterval(timer)
}
