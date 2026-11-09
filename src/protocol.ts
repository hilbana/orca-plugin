// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

/** One of Orca's five semantic tones; see tone.ts for how a Hilbana colour becomes one. */
export type StateTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type IssueRow = {
  id: string
  identifier: string
  title: string
  state: string | null
  /** The tone closest to the colour Hilbana gives this state. */
  stateTone: StateTone
  stateType: string | null
  project: string | null
  projectId: string | null
  assignee: string | null
  priority: string | number | null
  agentWorking: string | null
  labels: string[]
}

/** 'open' = everything alive (Hilbana's default), 'all' = also done and canceled,
 *  a category, or `state:<name>` for one specific state of the workspace. */
export type Scope =
  | 'open' | 'all' | 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  | `state:${string}`
export type IssuePage = { rows: IssueRow[]; total: number }

export type Comment = { id: string; author: string | null; body: string; createdAt: string | number }
export type Relation = { type: string; issueId: string | null; identifier: string; title: string | null; state: string; stateTone?: StateTone }
export type IssueRef = { id: string; identifier: string; title: string; state: string | null; stateTone?: StateTone }
export type IssueDetail = IssueRow & {
  /** The issue's children, in the order Hilbana returns them (by number). */
  subIssues: IssueRef[]
  relations: Relation[]
  description: string
  stateId: string | null
  teamId: string | null
  comments: Comment[]
}
export type AgentInfo = {
  terminalId: string
  title: string | null
  agent: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
}
export type WorkflowState = { id: string; name: string; type: string }

declare module 'orca' {
  interface PluginRequests {
    /** Tells the worker Orca's UI language so its messages match the panel. */
    'locale.set': { input: { locale: string }; output: { ok: true } }
    /** Is an API key saved? Never returns the key. */
    'auth.status': { output: { connected: boolean; url: string; protection: string } }
    /** Validates the key against Hilbana and, if it works, saves it in Orca's keyring. */
    'auth.save': { input: { key: string }; output: { workspaces: number } }
    'auth.clear': { output: { ok: true } }
    'workspaces.list': {
      output: { id: string; name: string; default: boolean }[]
    }
    'projects.list': {
      input: { workspaceId?: string }
      output: { id: string; name: string }[]
    }
    'issues.list': {
      /** With `query`, searches like the web app (local id/title ∪ full-text) across ALL issues, whatever their state, and ignores `scope`. */
      input: { workspaceId?: string; projectId?: string; scope: Scope; query?: string }
      output: IssuePage
    }
    /** Which Hilbana project (and issue) an Orca workspace corresponds to. In order: the issue its
     *  branch names (`drapps-2139-slug` -> DRAPPS-2139), a link learned from you, a name match. */
    'workspace.resolve': {
      input: { displayName: string; branch: string; workspaceId?: string }
      output: {
        key: string
        /** The Hilbana workspace this Orca workspace was linked to; null = leave the current one. */
        workspaceId: string | null
        projectId: string | null
        source: 'branch' | 'link' | 'name' | null
        issue: { id: string; identifier: string } | null
      }
    }
    /** Remember which Hilbana workspace and project an Orca workspace belongs to (both null = forget). */
    'workspace.link': { input: { key: string; projectId: string | null; workspaceId?: string | null }; output: { ok: true } }
    /** Which of these identifiers (mentioned in a text) are real issues; the rest are dropped. */
    'issues.resolve': { input: { identifiers: string[]; workspaceId?: string }; output: IssueRef[] }
    /** Agents running in the focused Orca workspace. */
    'agents.list': { output: AgentInfo[] }
    /** Types the configured prompt (default: the Hilbana plugin command) into that agent's terminal. */
    'agent.send': { input: { terminalId: string; identifier: string }; output: { sent: string } }
    'issue.get': { input: { id: string; workspaceId?: string }; output: IssueDetail }
    /** States of one team; without teamId, all the workspace's states with unique names. */
    'states.list': { input: { workspaceId?: string; teamId?: string }; output: WorkflowState[] }
    /** Writes: need an API key with write permissions. They return the updated issue. */
    'issue.setState': { input: { id: string; stateId: string }; output: IssueDetail }
    'issue.claim': { input: { id: string }; output: IssueDetail }
    'issue.release': { input: { id: string }; output: IssueDetail }
    'issue.comment': { input: { id: string; body: string }; output: IssueDetail }
  }
  interface PluginPanelEvents {
    /** The connection changed (key saved or removed) in another panel. */
    'auth.changed': { connected: boolean }
  }
}
