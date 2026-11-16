import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { GithubAccount, Settings } from '../../shared/types.ts'
import { getSettings, saveSettings } from './db.ts'
import { ghCliToken, whoAmI } from './github.ts'

/**
 * Settings an agent may change (MCP `update_settings`, `PATCH /api/settings`). Secrets are not in here on
 * purpose: tokens and API keys go into Dispatch's Settings forms, so they never pass through a chat.
 * Every field is optional; only what's given changes.
 */
const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name')
const reaction = z.string().regex(/^[a-z0-9_+-]+$/, 'emoji name without colons, e.g. eyes')
export const SettingsPatch = z
  .object({
    trackedRepos: z
      .object({ set: z.array(repo).optional(), add: z.array(repo).optional(), remove: z.array(repo).optional() })
      .optional()
      .describe('Repos whose every open PR is pulled in (owner/name). set replaces the list; add / remove change it'),
    githubAccounts: z
      .array(z.object({ account: z.string().describe('Account id, label or login'), label: z.string().min(1).optional(), orgs: z.array(z.string()).optional().describe('Limit to these orgs; [] = every org the token sees') }))
      .optional(),
    sync: z
      .object({ auto: z.boolean().optional(), intervalMinutes: z.number().int().min(1).max(120).optional(), mergedLookbackDays: z.number().int().min(1).max(90).optional() })
      .optional(),
    dependencies: z.object({ writeToDescription: z.boolean().optional(), writeBothSides: z.boolean().optional() }).optional(),
    jira: z
      .object({
        baseUrl: z.string().url().optional().describe('https://<company>.atlassian.net'),
        email: z.string().email().optional(),
        projectKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).optional(),
        myJql: z.string().optional(),
        create: z.object({ projectKey: z.string().optional(), issueType: z.string().optional(), assignToMe: z.boolean().optional() }).optional(),
      })
      .optional()
      .describe('Jira site and preferences; the API token is pasted in Settings → Jira'),
    slack: z
      .object({
        lookbackDays: z.number().int().min(1).max(60).optional(),
        maxConversations: z.number().int().min(1).max(200).optional(),
        includeSaved: z.boolean().optional(),
        todoReactions: z.array(reaction).optional(),
        doneReactions: z.array(reaction).optional(),
      })
      .optional()
      .describe('Only once Slack is connected (the token is pasted in Settings → Slack)'),
    launchdarkly: z
      .object({ baseUrl: z.string().url().optional(), projectKey: z.string().optional(), environments: z.array(z.string()).optional() })
      .optional()
      .describe('LaunchDarkly project and environments; the access token is pasted in Settings → LaunchDarkly'),
    ai: z.object({ provider: z.enum(['claude-code', 'api']).optional(), model: z.string().min(1).optional() }).optional(),
    releaseRefs: z.record(repo, z.string()).optional().describe('Per repo: the branch that means "released" (e.g. master); "" removes the override'),
    defaultReleaseRef: z.string().optional().describe('"latest-release" or a branch name'),
  })
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatch>

const lower = (r: string) => r.toLowerCase()

/** Applies a patch to settings; returns the new settings and one line per change (nothing is saved) */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): { settings: Settings; changes: string[] } {
  const s = structuredClone(current)
  const changes: string[] = []
  const note = (what: string, from: unknown, to: unknown) => JSON.stringify(from) !== JSON.stringify(to) && changes.push(`${what}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
  /** Sets the given keys of `target` from `values`, noting each change under `prefix` */
  const assign = <T extends object>(prefix: string, target: T, values: Partial<T>) => {
    const t = target as Record<string, unknown>
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue
      note(`${prefix}.${k}`, t[k], v)
      t[k] = v
    }
  }

  if (patch.trackedRepos) {
    const before = [...s.trackedRepos]
    let list = patch.trackedRepos.set ? patch.trackedRepos.set.map(lower) : s.trackedRepos.map(lower)
    for (const r of patch.trackedRepos.add ?? []) if (!list.includes(lower(r))) list.push(lower(r))
    const drop = new Set((patch.trackedRepos.remove ?? []).map(lower))
    list = list.filter((r) => !drop.has(r))
    s.trackedRepos = [...new Set(list)].sort()
    note('trackedRepos', before, s.trackedRepos)
  }
  for (const a of patch.githubAccounts ?? []) {
    const key = a.account.toLowerCase()
    const acc = s.github.accounts.find((x) => x.id === a.account || x.label.toLowerCase() === key || x.login?.toLowerCase() === key)
    if (!acc) throw new Error(`No GitHub account "${a.account}". Accounts: ${s.github.accounts.map((x) => `${x.label} (${x.login ?? x.id})`).join(', ') || 'none'}`)
    assign(`github[${acc.label}]`, acc, { label: a.label, orgs: a.orgs })
  }
  if (patch.sync) assign('sync', s.sync, patch.sync)
  if (patch.dependencies) assign('dependencies', s.dependencies, patch.dependencies)
  if (patch.jira) {
    const { create, ...rest } = patch.jira
    if (!s.jira) {
      if (!rest.baseUrl || !rest.email) throw new Error('Jira is not set up yet: give baseUrl and email (the API token is pasted in Settings → Jira)')
      s.jira = { baseUrl: '', email: '', apiToken: '', projectKeys: [], myJql: '', create: { projectKey: '', issueType: 'Task', assignToMe: true } }
      changes.push('jira: created (no API token yet)')
    }
    if (rest.baseUrl) rest.baseUrl = rest.baseUrl.replace(/\/+$/, '')
    assign('jira', s.jira, rest)
    if (create) assign('jira.create', s.jira.create, create)
  }
  if (patch.slack) {
    if (!s.slack) throw new Error('Slack is not connected yet: paste the user token (xoxp-…) in Settings → Slack first')
    assign('slack', s.slack, patch.slack)
  }
  if (patch.launchdarkly) {
    if (!s.launchdarkly) {
      if (!patch.launchdarkly.projectKey) throw new Error('LaunchDarkly is not set up yet: give projectKey (the access token is pasted in Settings → LaunchDarkly)')
      s.launchdarkly = { apiToken: '', baseUrl: 'https://app.launchdarkly.com', projectKey: '', environments: [] }
      changes.push('launchdarkly: created (no access token yet)')
    }
    const ld = { ...patch.launchdarkly, ...(patch.launchdarkly.baseUrl ? { baseUrl: patch.launchdarkly.baseUrl.replace(/\/+$/, '') } : {}) }
    assign('launchdarkly', s.launchdarkly, ld)
  }
  if (patch.ai) assign('ai', s.ai, patch.ai)
  for (const [r, ref] of Object.entries(patch.releaseRefs ?? {})) {
    const k = lower(r)
    note(`releaseRefs.${k}`, s.releaseRefs[k] ?? '', ref)
    if (ref) s.releaseRefs[k] = ref
    else delete s.releaseRefs[k]
  }
  if (patch.defaultReleaseRef !== undefined) assign('settings', s, { defaultReleaseRef: patch.defaultReleaseRef })
  return { settings: s, changes }
}

/** Validates, applies and saves a patch (secrets untouched); returns the changes */
export function updateSettings(input: unknown): string[] {
  const parsed = SettingsPatch.safeParse(input)
  if (!parsed.success) throw new Error(`Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(top level)'}: ${i.message}`).join('; ')}`)
  const patch = parsed.data
  const { settings, changes } = applySettingsPatch(getSettings(), patch)
  if (changes.length) saveSettings(settings)
  return changes
}

/** Settings without secrets: tokens become hasToken / hasKey */
export function maskSettings(s: Settings): Settings {
  return {
    ...s,
    github: { accounts: s.github.accounts.map((a) => ({ ...a, token: '', hasToken: !!a.token })) },
    jira: s.jira ? { ...s.jira, apiToken: '', hasToken: !!s.jira.apiToken } : null,
    slack: s.slack ? { ...s.slack, token: '', hasToken: !!s.slack.token } : null,
    launchdarkly: s.launchdarkly ? { ...s.launchdarkly, apiToken: '', hasToken: !!s.launchdarkly.apiToken } : null,
    ai: { ...s.ai, apiKey: '', hasKey: !!s.ai.apiKey },
  }
}

/**
 * Connect (or refresh) GitHub from the gh CLI login: the server reads `gh auth token` itself, so the
 * token never passes through the browser or a chat.
 */
export async function connectGhCli(): Promise<{ me: Awaited<ReturnType<typeof whoAmI>>; settings: Settings }> {
  const token = await ghCliToken()
  const me = await whoAmI(token)
  const s = getSettings()
  const existing = s.github.accounts.find((a) => a.source === 'gh-cli')
  const account: GithubAccount = existing
    ? { ...existing, token, login: me.login }
    : { id: randomUUID(), label: `${me.login} (gh CLI)`, token, login: me.login, orgs: [], source: 'gh-cli' }
  s.github.accounts = existing ? s.github.accounts.map((a) => (a.id === account.id ? account : a)) : [...s.github.accounts, account]
  saveSettings(s)
  return { me, settings: s }
}
