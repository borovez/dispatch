import type { UpdateStatus, PrRewrite, PrRewriteRequest, AiConfig, ImageAttachment, JiraAiDraft, JiraDraftRequest, RepoCatalog, JiraIssueTypeMeta, JiraCreateMeta, JiraEditable, JiraFieldKind, JiraFieldOption, JiraIssue, JiraProjectMeta, JiraWriteInput, JiraFieldValue, JiraIssueDetail, JiraLiveSearch, LinkedPrs, LinkPreview, PrDetail, PrStateChange, PrStateTarget, ReleasePlan, Overview, Settings, SlackContext, SlackMessage, SlackStatus, SlackUserProfile, SyncState } from '@shared/types'

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status} ${res.statusText}`)
  return json as T
}

export const api = {
  overview: () => call<Overview>('GET', '/overview'),
  sync: () => call<Overview>('POST', '/sync'),
  syncStatus: () => call<SyncState>('GET', '/sync/status'),
  setAutoSync: (enabled: boolean) => call<{ enabled: boolean }>('PUT', '/sync/auto', { enabled }),
  settings: () => call<Settings>('GET', '/settings'),
  saveSettings: (s: Settings) => call<Settings>('PUT', '/settings', s),
  testGithub: (token: string, accountId?: string) =>
    call<{ login: string; avatarUrl: string; orgs: string[] }>('POST', '/setup/github/test', { token, accountId }),
  importGhCli: () => call<{ login: string; orgs: string[]; settings: Settings }>('POST', '/setup/github/gh-cli'),
  /** Settings form: every Jira project, and a project's issue types, with the credentials being edited */
  jiraAllProjects: (baseUrl: string, email: string, apiToken: string) =>
    call<JiraProjectMeta[]>('POST', '/setup/jira/projects', { baseUrl, email, apiToken }),
  jiraIssueTypes: (baseUrl: string, email: string, apiToken: string, project: string) =>
    call<JiraIssueTypeMeta[]>('POST', '/setup/jira/issue-types', { baseUrl, email, apiToken, project }),
  repoCatalog: (refresh = false) => call<RepoCatalog>('GET', `/setup/github/repo-catalog${refresh ? '?refresh=1' : ''}`),
  testJira: (baseUrl: string, email: string, apiToken: string) =>
    call<{ displayName: string; accountId: string }>('POST', '/setup/jira/test', { baseUrl, email, apiToken }),
  aiInfo: () => call<{ env: boolean; claudeCode: string | null }>('GET', '/setup/ai'),
  testAi: (ai: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>) =>
    call<{ model: string; source: 'key' | 'environment' | 'claude-code' }>('POST', '/setup/ai/test', ai),
  mcpInfo: () => call<{ node: string; entry: string; dbPath: string; tsxCandidates: string[] }>('GET', '/setup/mcp'),
  addDep: (from: string, to: string, kind: 'merge' | 'release', note?: string) =>
    call<{ id?: number; written: boolean; writtenOther?: boolean; error?: string }>('POST', '/deps', { from, to, kind, note }),
  removeDepFromDescription: (from: string, to: string) => call('POST', '/deps/remove-from-description', { from, to }),
  removeDep: (id: number) => call('DELETE', `/deps/${id}`),
  prDetail: (id: string) => call<PrDetail>('GET', `/prs/detail?id=${encodeURIComponent(id)}`),
  /** Just the Slack inbox (the Slack page's refresh), not a full sync */
  slackRefresh: () => call<{ items: number; errors: string[] }>('POST', '/slack/refresh'),
  /** Fetch and store a PR Dispatch doesn't have yet ("not synced") */
  fetchPr: (id: string) => call<unknown>('POST', '/prs/fetch', { id }),
  resyncPr: (id: string) => call('POST', '/prs/resync', { id }),
  /** Ready for review / draft / close / reopen on GitHub */
  setPrState: (prId: string, to: PrStateTarget) => call<PrStateChange>('PUT', '/prs/state', { prId, to }),
  /** Resync just these PRs, the PRs their descriptions now depend on, and their Jira issues */
  /** Release planner: every repo's plan */
  releasePlans: () => call<ReleasePlan[]>('GET', '/releases/plan'),
  /** Where a PR merged into dev goes (decision null clears it) */
  setReleaseDecision: (prId: string, decision: 'release' | 'hold' | 'skip' | null, releaseId?: string | null, note?: string | null) =>
    call<{ ok: boolean }>('PUT', '/releases/decision', { prId, decision, releaseId, note }),
  /** Plan board: these PRs, in this order, go into a release (or are held / skipped) */
  arrangeRelease: (prIds: string[], decision: 'release' | 'hold' | 'skip', releaseId?: string | null) =>
    call<{ ok: boolean }>('PUT', '/releases/arrange', { prIds, decision, releaseId }),
  /** Planned releases (a branch Claude creates, or I open the PR for once it's pushed) */
  plannedCreate: (p: { repo: string; branch: string; base: string; title: string }) => call<{ id: string }>('POST', '/releases/planned', p),
  plannedUpdate: (p: { id: string; branch: string; base: string; title: string }) => call<{ ok: boolean }>('PUT', '/releases/planned', p),
  clearReleasePlan: (repo: string) => call<{ decisions: number; planned: number }>('DELETE', '/releases/plan', { repo }),
  repoBranches: (repo: string) => call<{ default: string; branches: string[] }>('GET', `/repos/branches?repo=${encodeURIComponent(repo)}`),
  plannedDelete: (id: string) => call<{ ok: boolean }>('DELETE', '/releases/planned', { id }),
  plannedOpenPr: (id: string) => call<{ number: number; url: string }>('POST', '/releases/planned/open-pr', { id }),
  releasePrompt: (repo: string) => call<{ prompt: string }>('GET', `/releases/plan/prompt?repo=${encodeURIComponent(repo)}`),
  /** Re-read these issues from Jira (the Jira page's refresh) */
  jiraRefreshMany: (keys: string[]) => call<{ issues: number; missing: string[]; moved: number }>('POST', '/jira/refresh-many', { keys }),
  resyncPrs: (ids: string[], repos?: string[]) =>
    call<{ prs: number; added: number; discovered?: number; jira: number; releases?: number; errors: string[] }>('POST', '/prs/resync-many', { ids, repos }),
  refreshRelease: (id: string) => call('POST', '/releases/refresh', { id }),
  setMeta: (id: string, note: string | null, pinned: boolean) => call('PUT', '/prs/meta', { id, note, pinned }),
  /** Mark the PR's current action done (`null` undoes it) */
  setDone: (id: string, action: string | null) => call('PUT', '/prs/done', { id, action }),
  prText: (id: string) => call<{ title: string; body: string }>('GET', `/prs/text?id=${encodeURIComponent(id)}`),
  prRewrite: (input: PrRewriteRequest, signal?: AbortSignal) => call<PrRewrite>('POST', '/prs/rewrite', input, signal),
  savePrText: (input: { prId: string; title?: string; body?: string }) => call<{ ok: boolean }>('PUT', '/prs/text', input),
  jiraAgentPrompt: (key: string) => call<{ prompt: string }>('GET', `/jira/${encodeURIComponent(key)}/agent-prompt`),
  updateStatus: (refresh = false) => call<UpdateStatus>('GET', `/update${refresh ? '?refresh=1' : ''}`),
  startUpdate: () => call<{ started: boolean }>('POST', '/update'),
  health: () => call<{ ok: boolean; version: string }>('GET', '/health'),
  jiraProjects: () => call<JiraProjectMeta[]>('GET', '/jira/projects'),
  jiraMeta: (project: string, type?: string) =>
    call<JiraCreateMeta>('GET', `/jira/meta?project=${encodeURIComponent(project)}${type ? `&type=${encodeURIComponent(type)}` : ''}`),
  jiraOptions: (q: { kind: JiraFieldKind; project: string; q?: string; issue?: string; field?: string }) =>
    call<JiraFieldOption[]>('GET', `/jira/options?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  jiraEditable: (key: string) => call<JiraEditable>('GET', `/jira/${encodeURIComponent(key)}/editable`),
  jiraCreateIssue: (input: JiraWriteInput) => call<JiraIssue & { replied: boolean; attachError: string | null }>('POST', '/jira/issues', input),
  jiraDraft: (input: JiraDraftRequest, signal?: AbortSignal) => call<JiraAiDraft>('POST', '/jira/draft', input, signal),
  jiraUpdateIssue: (key: string, changes: { summary?: string; description?: string; issueTypeId?: string; values?: Record<string, JiraFieldValue>; attachments?: ImageAttachment[]; comment?: string }) =>
    call<JiraIssue>('PUT', `/jira/issues/${encodeURIComponent(key)}`, changes),
  /** Search palette: Jira issues matching the text or key, live (not stored) */
  jiraSearch: (q: string, signal?: AbortSignal) => call<JiraLiveSearch>('GET', `/jira/search?q=${encodeURIComponent(q)}`, undefined, signal),
  jiraRefresh: (key: string) => call<JiraIssue>('POST', `/jira/${encodeURIComponent(key)}/refresh`),
  /** PRs naming the key beyond the synced ones: GitHub search and Jira's development panel */
  jiraLinkedPrs: (key: string, refresh = false) => call<LinkedPrs>('GET', `/jira/${encodeURIComponent(key)}/linked-prs${refresh ? '?refresh=1' : ''}`),
  jiraDetail: (key: string) => call<JiraIssueDetail>('GET', `/jira/${encodeURIComponent(key)}/detail`),
  transitions: (key: string) =>
    call<{ id: string; name: string; to: string; toCategory: string }[]>('GET', `/jira/${key}/transitions`),
  transition: (key: string, id: string) => call('POST', `/jira/${key}/transitions`, { id }),
  testLaunchDarkly: (cfg: { apiToken: string; baseUrl: string; projectKey: string }) =>
    call<{ project: string; environments: string[] }>('POST', '/setup/launchdarkly/test', cfg),
  testSlack: (token: string) => call<{ userId: string; user: string; team: string; url: string }>('POST', '/setup/slack/test', { token }),
  slackAround: (id: string, before = 2, after = 2) =>
    call<SlackContext>('GET', `/slack/${encodeURIComponent(id)}/around?before=${before}&after=${after}`),
  slackPrompt: (id: string, before?: number, after?: number) =>
    call<{ prompt: string }>('GET', `/slack/${encodeURIComponent(id)}/prompt${before === undefined ? '' : `?before=${before}&after=${after ?? before}`}`),
  setupPrompt: () => call<{ prompt: string }>('GET', '/setup/prompt'),
  slackThread: (id: string, ts: string) => call<SlackMessage[]>('GET', `/slack/${encodeURIComponent(id)}/thread-replies?ts=${encodeURIComponent(ts)}`),
  slackReply: (id: string, text: string, threadTs?: string | null) => call<{ ok: boolean; ts: string }>('POST', `/slack/${encodeURIComponent(id)}/reply`, { text, threadTs }),
  slackDeleteMessage: (id: string, ts: string) => call<{ ok: boolean }>('DELETE', `/slack/${encodeURIComponent(id)}/messages/${encodeURIComponent(ts)}`),
  slackEmoji: () => call<{ emoji: Record<string, string>; error?: string }>('GET', '/slack/emoji'),
  slackUser: (id: string) => call<SlackUserProfile>('GET', `/slack/users/${encodeURIComponent(id)}`),
  linkPreview: (url: string, signal?: AbortSignal) => call<LinkPreview>('GET', `/link-preview?url=${encodeURIComponent(url)}`, undefined, signal),
  slackPin: (id: string, pinned: boolean) => call<{ ok: boolean }>('PUT', `/slack/${encodeURIComponent(id)}/pin`, { pinned }),
  slackStatus: (id: string, status: SlackStatus) =>
    call<{ ok: boolean; slack: { reaction: string; done: boolean } | null; warning?: string }>('PUT', `/slack/${encodeURIComponent(id)}/status`, { status }),
}
