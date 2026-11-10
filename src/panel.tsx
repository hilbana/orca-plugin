// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Button,
  Callout,
  Collapsible,
  Card,
  EmptyState,
  env,
  Heading,
  Image,
  IconButton,
  Input,
  List,
  Markdown,
  ListItem,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  settings,
  Spinner,
  Switch,
  Textarea,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import { langOf, setLang, stateName, t } from './i18n'
import { extractRefs } from './match'
import type { Account, AgentInfo, IssueDetail, IssueRef, IssueRow, Scope, StateTone, WorkflowState } from './protocol'

const connected = atom<boolean | null>(null)
const keyDraft = atom('')
const nameDraft = atom('')
/** Hilbana logins with a key saved, and the one every request uses (the worker owns this choice). */
const accounts = atom<Account[]>([])
const accountId = atom('')
/** Show the connect form to add another account, even though one is already connected. */
const adding = atom(false)
const error = atom<string | null>(null)
const busy = atom(false)
const issues = atom<IssueRow[]>([])
const workspaces = atom<{ id: string; name: string; default: boolean }[]>([])
const projects = atom<{ id: string; name: string }[]>([])
const workspaceId = atom('workspaceId', '', { persist: 'plugin' })
const projectId = atom('projectId', '', { persist: 'plugin' })
const scope = atom<Scope>('scope', 'started', { persist: 'plugin' })
const search = atom('')
/** Follow Orca's workspace: when the branch changes, select its project and open its issue. */
const follow = atom('follow', true, { persist: 'plugin' })
/** The search already sent to the server; '' = the normal list, driven by filters. */
const activeQuery = atom('')
const detail = atom<IssueDetail | null>(null)
const states = atom<WorkflowState[]>([])
const allStates = atom<WorkflowState[]>([])
const total = atom(0)
const commentDraft = atom('')
/** Issues visited by navigating; "back" steps through these before returning to the list. */
const trail = atom<string[]>([])
const mentions = atom<IssueRef[]>([])
/** Agents in Orca's focused workspace, and the one the "Run in agent" button targets. */
const agents = atom<AgentInfo[]>([])
const agentTerminal = atom('')
const notice = atom<string | null>(null)
/** Key of Orca's focused workspace, so a manual project choice can be remembered for it. */
const orcaKey = atom('')
const linkNote = atom<string | null>(null)
const projectFilter = atom('')
/** The account / workspace / project block can fold away once it is set, to leave room for the list. */
const filtersOpen = atom('filtersOpen', true, { persist: 'plugin' })

/** Orca rejects options with an empty value: "all" uses this sentinel. */
const ALL = '__all__'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function guard(work: () => Promise<void>): Promise<void> {
  set(busy, true)
  set(error, null)
  try {
    await work()
  } catch (e) {
    set(error, message(e))
  } finally {
    set(busy, false)
  }
}

/** Only the latest request counts: with live search, a stale reply must not overwrite a newer one. */
let loadSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function loadIssues(): Promise<void> {
  const mine = ++loadSeq
  // No undefined keys: plugin.request requires JSON and rejects them with "Invalid input".
  const input: { workspaceId?: string; projectId?: string; scope: Scope; query?: string } = { scope: read(scope) }
  if (read(workspaceId)) input.workspaceId = read(workspaceId)
  if (read(projectId)) input.projectId = read(projectId)
  if (read(activeQuery)) input.query = read(activeQuery)
  const page = await plugin.request('issues.list', input)
  if (mine !== loadSeq) return
  set(issues, page.rows)
  set(total, page.total)
}

async function loadProjects(): Promise<void> {
  const ws = read(workspaceId)
  set(projects, await plugin.request('projects.list', ws ? { workspaceId: ws } : {}))
}

async function loadAllStates(): Promise<void> {
  const ws = read(workspaceId)
  set(allStates, await plugin.request('states.list', ws ? { workspaceId: ws } : {}))
}

async function refreshAgents(): Promise<void> {
  const list = await plugin.request('agents.list')
  set(agents, list)
  // Keep the chosen agent while it exists; otherwise fall back to the first one.
  if (!list.some((agent) => agent.terminalId === read(agentTerminal))) set(agentTerminal, list[0]?.terminalId ?? '')
}

async function runInAgent(identifier: string): Promise<void> {
  await guard(async () => {
    const { sent } = await plugin.request('agent.send', { terminalId: read(agentTerminal), identifier })
    set(notice, t('sentToAgent', { text: sent }))
    await refreshAgents()
  })
}

async function bootstrap(): Promise<void> {
  const status = await plugin.request('auth.status')
  set(connected, status.connected)
  set(accounts, status.accounts)
  set(accountId, status.activeId ?? '')
  if (!status.connected) return
  await guard(async () => {
    const list = await plugin.request('workspaces.list')
    set(workspaces, list)
    if (!read(workspaceId) || !list.some((w) => w.id === read(workspaceId))) {
      set(workspaceId, list.find((w) => w.default)?.id ?? list[0]?.id ?? '')
    }
    await loadProjects()
    await loadAllStates()
    await loadIssues()
  })
}

/** Everything on screen belongs to the account that was active: forget it before loading the new one. */
function forgetAccountState(): void {
  set(workspaceId, '')
  set(projectId, '')
  set(projectFilter, '')
  set(detail, null)
  set(trail, [])
  set(mentions, [])
  set(issues, [])
  set(total, 0)
}

/** Make another saved account the active one and load its workspaces. */
async function switchAccount(id: string): Promise<void> {
  await plugin.request('account.select', { accountId: id })
  forgetAccountState()
  await bootstrap()
}

const connect = () =>
  guard(async () => {
    const input: { key: string; name?: string } = { key: read(keyDraft) }
    if (read(nameDraft).trim()) input.name = read(nameDraft).trim()
    await plugin.request('auth.save', input)
    set(keyDraft, '') // the key does not linger in the panel's memory
    set(nameDraft, '')
    set(adding, false)
    forgetAccountState() // the new account is now the active one
    await bootstrap()
  })

const cancelAdding = () => {
  set(keyDraft, '')
  set(nameDraft, '')
  set(adding, false)
  set(error, null)
}

/** Removes the active account and its key; if another is left, the panel carries on with it. */
const removeAccount = () =>
  guard(async () => {
    await plugin.request('auth.clear', { accountId: read(accountId) })
    forgetAccountState()
    await bootstrap()
  })

/** Mentions of other issues in the description and comments, validated against real issues. */
async function loadMentions(issue: IssueDetail): Promise<void> {
  const refs = extractRefs([issue.description, ...issue.comments.map((c) => c.body)].join('\n'), issue.identifier)
  if (refs.length === 0) { set(mentions, []); return }
  const input: { identifiers: string[]; workspaceId?: string } = { identifiers: refs }
  if (read(workspaceId)) input.workspaceId = read(workspaceId)
  const found = await plugin.request('issues.resolve', input)
  // Keeps the order of appearance in the text.
  set(mentions, refs.map((id) => found.find((f) => f.identifier === id)).filter((f): f is IssueRef => Boolean(f)))
}

/** Go to another issue, remembering the one you came from. */
function goTo(id: string): void {
  const current = read(detail)
  if (current && current.id !== id) set(trail, [...read(trail), current.id])
  void openIssue(id)
}

async function openIssue(id: string): Promise<void> {
  await guard(async () => {
    const input: { id: string; workspaceId?: string } = { id }
    if (read(workspaceId)) input.workspaceId = read(workspaceId)
    const issue = await plugin.request('issue.get', input)
    set(detail, issue)
    set(commentDraft, '')
    set(states, [])
    await loadMentions(issue)
    if (issue.teamId) {
      const input: { teamId: string; workspaceId?: string } = { teamId: issue.teamId }
      if (read(workspaceId)) input.workspaceId = read(workspaceId)
      set(states, await plugin.request('states.list', input))
    }
  })
}

/** Run a write action and replace the detail with the updated issue. */
const act = (run: () => Promise<IssueDetail>) =>
  guard(async () => {
    const updated = await run()
    set(detail, updated)
    await loadMentions(updated)
    syncRow(updated)
  })

/** The list behind the open issue reflects its changes without being reloaded. */
function syncRow(updated: IssueDetail): void {
  set(issues, read(issues).map((row) => (row.id === updated.id
    ? { ...row, state: updated.state, stateTone: updated.stateTone, stateType: updated.stateType, agentWorking: updated.agentWorking }
    : row)))
}

const POLL_DEFAULT_SECONDS = 10

/** Re-reads the open issue, so what changes on the server shows up here without a click. */
async function refreshOpenIssue(): Promise<void> {
  const current = read(detail)
  if (!current || read(busy)) return
  const input: { id: string; workspaceId?: string } = { id: current.id }
  if (read(workspaceId)) input.workspaceId = read(workspaceId)
  const fresh = await plugin.request('issue.get', input)
  // The person moved to another issue, or started an action that will bring a fresher copy: drop this one.
  const now = read(detail)
  if (!now || now.id !== current.id || read(busy)) return
  if (JSON.stringify(fresh) === JSON.stringify(now)) return // nothing changed: do not repaint
  set(detail, fresh)
  if (fresh.description !== now.description || fresh.comments.length !== now.comments.length) await loadMentions(fresh)
  syncRow(fresh)
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })

/** Refreshes the open issue every few seconds while the panel is visible. The comment you are
 *  typing is a separate value, so it is never touched. */
async function pollLoop(ctx: PanelContext): Promise<void> {
  let failures = 0
  while (!ctx.signal.aborted) {
    const configured = Number(await Promise.resolve(settings.get('refreshSeconds')).catch(() => POLL_DEFAULT_SECONDS))
    const seconds = Number.isFinite(configured) ? configured : POLL_DEFAULT_SECONDS
    // With 0 (off) it still wakes up now and then, in case the setting is turned on later.
    await sleep((seconds > 0 ? seconds : POLL_DEFAULT_SECONDS) * 1000, ctx.signal)
    if (ctx.signal.aborted || seconds <= 0 || !read(ctx.visible)) continue
    try {
      await refreshOpenIssue()
    } catch (e) {
      // A passing hiccup stays silent; a lasting one (say the issue was deleted) is shown once.
      failures++
      if (failures === 3) set(error, message(e))
      continue
    }
    if (failures >= 3) set(error, null)
    failures = 0
  }
}

function closeDetail(): void {
  set(error, null)
  set(notice, null)
  const back = read(trail)
  if (back.length > 0) {
    set(trail, back.slice(0, -1))
    void openIssue(back[back.length - 1]!)
    return
  }
  set(detail, null)
  set(mentions, [])
}

let ready: Promise<void> = Promise.resolve()
let lastWorkspace = ''

/** Switch the Hilbana workspace: its projects and states replace the previous ones. */
async function switchWorkspace(id: string): Promise<void> {
  set(workspaceId, id)
  set(projectId, '')
  set(projectFilter, '')
  set(detail, null)
  set(trail, [])
  await loadProjects()
  await loadAllStates()
}

/** Orca's workspace changed: select its Hilbana project and, if its branch names one, open that issue. */
async function followWorkspace(displayName: string, branch: string): Promise<void> {
  const signature = `${displayName}\n${branch}`
  if (!read(follow) || !displayName || signature === lastWorkspace) return
  lastWorkspace = signature
  await ready
  if (!read(connected)) return
  const input: { displayName: string; branch: string; workspaceId?: string } = { displayName, branch }
  if (read(workspaceId)) input.workspaceId = read(workspaceId)
  const found = await plugin.request('workspace.resolve', input)
  set(orcaKey, found.key)
  set(linkNote, found.source === 'link' ? t('rememberedFor', { key: found.key }) : found.source === 'name' ? t('matchedByName', { key: found.key }) : null)
  // The account first: its workspaces and projects are what the rest of the link refers to.
  if (found.accountId && found.accountId !== read(accountId) && read(accounts).some((a) => a.id === found.accountId)) {
    await guard(() => switchAccount(found.accountId!))
  }
  // A remembered Hilbana workspace next (if you still belong to it), then the project inside it.
  const switching = Boolean(found.workspaceId) && found.workspaceId !== read(workspaceId) && read(workspaces).some((w) => w.id === found.workspaceId)
  if (switching) await guard(() => switchWorkspace(found.workspaceId!))
  if (!found.projectId) {
    if (switching) await guard(loadIssues)
    return
  }
  const changed = switching || found.projectId !== read(projectId)
  if (changed) {
    set(projectId, found.projectId)
    set(projectFilter, '')
    await guard(loadIssues)
  }
  if (found.issue) {
    set(trail, [])
    await openIssue(found.issue.id)
  } else if (changed) {
    // A different project: an issue left open from the previous one no longer belongs here.
    set(detail, null)
    set(trail, [])
  }
}

/** The person chose a Hilbana account, workspace or project by hand: remember them for this Orca workspace. */
async function rememberChoice(): Promise<void> {
  const key = read(orcaKey)
  if (!read(follow) || !key) return
  const chosenProject = read(projectId) || null
  const chosenWorkspace = read(workspaceId) || null
  // With a single account there is nothing to remember about it.
  const chosenAccount = read(accounts).length > 1 ? read(accountId) || null : null
  await plugin.request('workspace.link', { key, projectId: chosenProject, workspaceId: chosenWorkspace, accountId: chosenAccount })
  set(linkNote, chosenProject || chosenWorkspace || chosenAccount ? t('rememberedFor', { key }) : null)
}

/** Runs once before the first render. */
export function setup(ctx: PanelContext): void {
  setLang(langOf(env.locale))
  void plugin.request('locale.set', { locale: env.locale }).catch(() => undefined) // the worker speaks the same language
  ctx.subscriptions.push(plugin.on('auth.changed', ({ connected: c }) => set(connected, c)))
  ready = bootstrap().catch((e) => set(error, message(e)))
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      void refreshAgents().catch(() => undefined)
      if (context) void followWorkspace(context.displayName, context.branch).catch((e) => set(error, message(e)))
    }),
    on('agent.status.changed', () => void refreshAgents().catch(() => undefined))
  )
  void refreshAgents().catch(() => undefined) // before the capability is approved this just fails quietly
  void pollLoop(ctx)
}

function describe(issue: IssueRow): string {
  return [issue.project, issue.assignee, issue.agentWorking ? `🤖 ${issue.agentWorking}` : null]
    .filter(Boolean)
    .join(' · ')
}

function Connect() {
  const another = read(accounts).length > 0
  return (
    <Stack gap="sm">
      <Row gap="xs">
        <Image src="assets/icon.png" alt="Hilbana" size="xs" />
        <Heading>{another ? t('addAccount') : t('connectTitle')}</Heading>
      </Row>
      <Text muted size="sm">
        {t('connectHelp')}
      </Text>
      {another ? <Text muted size="sm">{t('addAccountHelp')}</Text> : null}
      <Input
        label={t('accountName')}
        placeholder={t('accountNamePlaceholder')}
        value={read(nameDraft)}
        onChange={(v) => set(nameDraft, v)}
      />
      <Input
        label={t('apiKey')}
        type="password"
        placeholder="hil_…"
        value={read(keyDraft)}
        onChange={(v) => set(keyDraft, v)}
        onSubmit={connect}
      />
      <Row gap="xs">
        <Button onPress={connect} disabled={read(busy) || !read(keyDraft).trim()}>
          {t('connect')}
        </Button>
        {another ? <Button variant="outline" onPress={cancelAdding}>{t('cancel')}</Button> : null}
      </Row>
    </Stack>
  )
}

function scopeOptions(list: WorkflowState[]) {
  return [
    { value: 'started', label: t('scopeStarted') },
    { value: 'unstarted', label: t('scopeUnstarted') },
    { value: 'open', label: t('scopeOpen') },
    { value: 'all', label: t('scopeAll') },
    { value: 'triage', label: t('catTriage') },
    { value: 'backlog', label: t('catBacklog') },
    { value: 'completed', label: t('catDone') },
    { value: 'canceled', label: t('catCanceled') },
    ...[...list]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((state) => ({ value: `state:${state.name}`, label: t('stateOption', { name: state.name }) }))
  ]
}

function Board() {
  const rows = read(issues)
  const searching = Boolean(read(activeQuery))
  const runSearch = () => {
    clearTimeout(searchTimer)
    set(activeQuery, read(search).trim())
    void guard(loadIssues)
  }
  // Live, with the same 250 ms debounce as the Hilbana web app.
  const typeSearch = (v: string) => {
    set(search, v)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(runSearch, 250)
  }
  const wsOptions = read(workspaces).map((w) => ({ value: w.id, label: w.name }))
  // What the folded block shows: where you are, e.g. "Work › Drapps › Hilbana (SaaS)".
  const where = [
    read(accounts).length > 1 ? read(accounts).find((a) => a.id === read(accountId))?.name : null,
    wsOptions.length > 1 ? wsOptions.find((w) => w.value === read(workspaceId))?.label : null,
    read(projects).find((p) => p.id === read(projectId))?.name ?? t('allProjects')
  ].filter(Boolean).join(' › ')
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const pjNeedle = norm(read(projectFilter).trim())
  const pjOptions = [
    { value: ALL, label: t('allProjects') },
    ...[...read(projects)]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      // The selected project never disappears from the list, even if the filter excludes it.
      .filter((p) => !pjNeedle || norm(p.name).includes(pjNeedle) || p.id === read(projectId))
      .map((p) => ({ value: p.id, label: p.name }))
  ]
  return (
    <Stack gap="sm">
      <Row justify="between">
        <Row gap="xs">
          <Image src="assets/icon.png" alt="Hilbana" size="xs" />
          <Heading>{t('issues')}</Heading>
        </Row>
        <Row gap="xs">
          <Badge tone="accent">{rows.length}</Badge>
          <IconButton icon="refresh" label={t('reload')} onPress={() => guard(loadIssues)} disabled={read(busy)} />
          <IconButton icon="add" label={t('addAccount')} onPress={() => set(adding, true)} />
          <IconButton icon="close" label={read(accounts).length > 1 ? t('removeAccount') : t('disconnect')} onPress={removeAccount} />
        </Row>
      </Row>
      <Collapsible title={where} open={read(filtersOpen)} onChange={(open) => set(filtersOpen, open)}>
      <Stack gap="sm">
      {read(accounts).length > 1 ? (
        <Select
          label={t('account')}
          labelHidden
          value={read(accountId)}
          options={read(accounts).map((a) => ({ value: a.id, label: a.name }))}
          onChange={(v) => {
            if (v === read(accountId)) return
            void guard(() => switchAccount(v)).then(() => rememberChoice()).catch(() => undefined)
          }}
        />
      ) : null}
      {wsOptions.length > 1 ? (
        <Select
          label={t('workspace')}
          labelHidden
          value={read(workspaceId)}
          options={wsOptions}
          onChange={(v) => {
            void guard(async () => { await switchWorkspace(v); await loadIssues() })
            void rememberChoice().catch(() => undefined)
          }}
        />
      ) : null}
      <Switch label={t('followSwitch')} checked={read(follow)} onChange={(v) => set(follow, v)} />
      <Input
        label={t('filterProjectsLabel')}
        labelHidden
        type="search"
        placeholder={t('filterProjects')}
        value={read(projectFilter)}
        onChange={(v) => set(projectFilter, v)}
      />
      <Select
        label={t('project')}
        labelHidden
        value={read(projectId) || ALL}
        options={pjOptions}
        onChange={(v) => {
          set(projectId, v === ALL ? '' : v)
          void guard(loadIssues)
          void rememberChoice().catch(() => undefined)
        }}
      />
      {read(linkNote) ? <Text muted size="xs">{read(linkNote)}</Text> : null}
      </Stack>
      </Collapsible>
      <Select
        label={t('state')}
        labelHidden
        value={read(scope)}
        disabled={searching}
        options={scopeOptions(read(allStates))}
        onChange={(v) => { set(scope, v as Scope); void guard(loadIssues) }}
      />
      <Row gap="xs">
        <Input label={t('search')} labelHidden type="search" placeholder={t('searchIssues')} value={read(search)} onChange={typeSearch} onSubmit={runSearch} />
        <IconButton icon="search" label={t('search')} onPress={runSearch} disabled={read(busy)} />
      </Row>
      {read(total) > read(issues).length ? (
        <Callout tone="warning">{t('showing', { n: read(issues).length, total: read(total) })}</Callout>
      ) : null}
      {read(busy) && read(issues).length === 0 ? (
        <Spinner label={t('loadingIssues')} />
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title={t('noIssues')} description={t('noMatch')} />
      ) : (
        <List label={t('issues')}>
          {rows.map((issue) => (
            <ListItem
              key={issue.id}
              icon={issue.agentWorking ? 'agent' : issue.stateType === 'started' ? 'play' : 'stop'}
              title={`${issue.identifier} ${issue.title}`}
              description={describe(issue)}
              onPress={() => void openIssue(issue.id)}
            >
              {issue.state ? <Badge tone={issue.stateTone}>{issue.state}</Badge> : null}
            </ListItem>
          ))}
        </List>
      )}
    </Stack>
  )
}

const relationLabel = (type: string) =>
  type === 'blocks' ? t('relBlocks') : type === 'blocked_by' ? t('relBlockedBy') : type === 'relates' ? t('relRelates') : type

/** Issues you can jump to; renders nothing when empty. */
function RefList({ title, items }: { title: string; items: { id: string; label: string; state: string; tone?: StateTone }[] }) {
  if (items.length === 0) return null
  return (
    <Stack gap="xs">
      <Heading level={3}>{title} ({items.length})</Heading>
      <List label={title}>
        {items.map((item) => (
          <ListItem key={item.id} icon="link" title={item.label} onPress={() => goTo(item.id)}>
            {item.state ? <Badge tone={item.tone ?? 'neutral'}>{item.state}</Badge> : null}
          </ListItem>
        ))}
      </List>
    </Stack>
  )
}

/** Runs the Hilbana command in the agent of Orca's focused workspace. */
function AgentRun({ identifier }: { identifier: string }) {
  const list = read(agents)
  const target = list.find((agent) => agent.terminalId === read(agentTerminal)) ?? list[0]
  const idle = target?.state === 'waiting' || target?.state === 'done'
  const name = (agent: AgentInfo) => `${agent.agent ?? agent.title ?? t('agentLabel')} · ${stateName(agent.state)}`
  // The button is always visible; when it cannot be used, the line below says why.
  const status = !target
    ? t('noAgent')
    : idle
      ? t('agentTarget', { name: name(target) })
      : t('agentBusy', { state: stateName(target.state) })
  return (
    <Stack gap="xs">
      {list.length > 1 && target ? (
        <Select
          label={t('agentLabel')}
          labelHidden
          value={target.terminalId}
          options={list.map((agent) => ({ value: agent.terminalId, label: name(agent) }))}
          onChange={(v) => set(agentTerminal, v)}
        />
      ) : null}
      <Button
        icon="agent"
        disabled={read(busy) || !idle}
        onPress={() => void runInAgent(identifier)}
        tooltip={t('runTooltip')}
      >
        {t('runInAgent')}
      </Button>
      <Text muted size="xs">{status}</Text>
      {read(notice) ? <Text size="xs" tone="success">{read(notice)}</Text> : null}
    </Stack>
  )
}

function Detail({ issue }: { issue: IssueDetail }) {
  const taken = Boolean(issue.agentWorking)
  const sendComment = () => act(async () => {
    const updated = await plugin.request('issue.comment', { id: issue.id, body: read(commentDraft) })
    set(commentDraft, '')
    return updated
  })
  return (
    <Stack gap="sm">
      <Row justify="between">
        <Row gap="xs">
          <IconButton icon="close" label={t('back')} onPress={closeDetail} />
          <Heading level={2}>{issue.identifier}</Heading>
        </Row>
        <IconButton icon="refresh" label={t('reloadIssue')} disabled={read(busy)} onPress={() => void openIssue(issue.id)} />
      </Row>
      <Text weight="semibold">{issue.title}</Text>
      <Row gap="xs" wrap>
        {issue.state ? <Badge tone={issue.stateTone}>{issue.state}</Badge> : null}
        {issue.project ? <Badge>{issue.project}</Badge> : null}
        {issue.assignee ? <Badge>{issue.assignee}</Badge> : null}
        {issue.labels.map((label) => <Badge key={label}>{label}</Badge>)}
      </Row>
      {issue.agentWorking ? <Text size="sm" tone="warning">{t('agentInProgress', { name: issue.agentWorking ?? '' })}</Text> : null}

      <Select
        label={t('state')}
        value={issue.stateId ?? ''}
        placeholder={t('changeState')}
        disabled={read(busy) || read(states).length === 0}
        options={read(states).map((state) => ({ value: state.id, label: state.name }))}
        onChange={(v) => { if (v && v !== issue.stateId) void act(() => plugin.request('issue.setState', { id: issue.id, stateId: v })) }}
      />
      <Text muted size="xs">{t('claimNote')}</Text>
      <Row gap="xs">
        {taken ? (
          <Button variant="outline" icon="stop" disabled={read(busy)} onPress={() => void act(() => plugin.request('issue.release', { id: issue.id }))}>{t('release')}</Button>
        ) : (
          <Button variant="outline" icon="play" disabled={read(busy)} onPress={() => void act(() => plugin.request('issue.claim', { id: issue.id }))}>{t('claim')}</Button>
        )}
      </Row>

      <AgentRun identifier={issue.identifier} />

      <Heading level={3}>{t('description')}</Heading>
      {issue.description.trim() ? <Markdown content={issue.description} /> : <Text muted size="sm">{t('noDescription')}</Text>}

      <RefList title={t('subIssues')} items={issue.subIssues.map((child) => ({ id: child.id, label: `${child.identifier} ${child.title}`, state: child.state ?? '', tone: child.stateTone }))} />
      <RefList title={t('related')} items={issue.relations.filter((r) => r.issueId).map((r) => ({ id: r.issueId!, label: `${relationLabel(r.type)} · ${r.identifier}${r.title ? ' ' + r.title : ''}`, state: r.state, tone: r.stateTone }))} />
      <RefList
        title={t('mentioned')}
        items={read(mentions)
          .filter((m) => !issue.relations.some((r) => r.issueId === m.id) && !issue.subIssues.some((child) => child.id === m.id))
          .map((m) => ({ id: m.id, label: `${m.identifier} ${m.title}`, state: m.state ?? '', tone: m.stateTone }))}
      />

      <Heading level={3}>{t('comments')} ({issue.comments.length})</Heading>
      <Textarea
        label={t('newComment')}
        labelHidden
        rows={4}
        placeholder={t('commentPlaceholder')}
        value={read(commentDraft)}
        onChange={(v) => set(commentDraft, v)}
        onSubmit={sendComment}
      />
      <Button disabled={read(busy) || !read(commentDraft).trim()} onPress={sendComment}>{t('comment')}</Button>
      {/* Newest first. */}
      {[...issue.comments].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))).map((comment) => (
        <Card key={comment.id} title={comment.author ?? t('system')} description={new Date(comment.createdAt).toLocaleString(env.locale)}>
          <Markdown content={comment.body} />
        </Card>
      ))}
    </Stack>
  )
}

export default function Panel() {
  const state = read(connected)
  return (
    <Stack gap="md">
      {read(error) ? <Callout tone="danger" title={t('error')}>{read(error)}</Callout> : null}
      {state === null ? <Spinner label={t('connecting')} /> : !state || read(adding) ? <Connect /> : read(detail) ? <Detail issue={read(detail)!} /> : <Board />}
    </Stack>
  )
}
