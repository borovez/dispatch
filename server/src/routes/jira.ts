import { adfToMarkdown } from '../../../shared/adf.ts'
import { z } from 'zod'
import type { LinkedPrs, JiraFieldKind, JiraFieldOption } from '../../../shared/types.ts'
import { addJiraMoved, listPrs, getSettings, getSlackItem, listJira, replaceJira, setSlackStatus, upsertJira } from '../db.ts'
import { draftJiraIssue } from '../ai.ts'
import { buildAgentPrompt } from '../agentPrompt.ts'
import { claudeMdGuide } from '../guides.ts'
import { replyInThread, threadContext } from '../slack.ts'
import { prFileNames } from '../github.ts'
import { addAttachments, addComment, hasAttachmentRefs, resolveAttachmentRefs, composeCreate, composeUpdate, createMeta, editable, fieldOptions, getIssue, getIssueDetail, getTransitions, jiraMyself, listProjects, transition } from '../jira.ts'
import { findLinkedPrs } from '../linkedPrs.ts'
import { accountForOwner } from '../sync.ts'
import { api, bad, jiraCfg, Images } from './shared.ts'

/** Jira: issue detail, linked PRs, transitions, the composer (create / edit / draft) */
// ---------- Jira issue detail (side panel) ----------
/** Re-read one issue from Jira into the cache (e.g. a parent the sync didn't fetch) */
api.post('/jira/:key/refresh', async (c) => {
  // An issue the sync didn't fetch stays off the Jira page list (parentOnly)
  const asked = c.req.param('key').toUpperCase()
  const issue = { ...(await getIssue(jiraCfg(), asked)), parentOnly: true }
  upsertJira(issue)
  // Moved issue (Jira answers the old key with the new one): remember it, so the old key resolves
  if (issue.key !== asked) addJiraMoved({ [asked]: issue.key })
  return c.json(issue)
})

api.get('/jira/:key/detail', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  return c.json(await getIssueDetail(cfg, c.req.param('key')))
})

// ---------- PRs naming a Jira issue (beyond the synced ones) ----------
/** Per key, 10 minutes; `?refresh=1` skips it */
const linkedCache = new Map<string, { at: number; value: Promise<LinkedPrs> }>()
api.get('/jira/:key/linked-prs', async (c) => {
  const key = c.req.param('key').toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw bad('Not a Jira key')
  const hit = linkedCache.get(key)
  if (hit && !c.req.query('refresh') && Date.now() - hit.at < 10 * 60_000) return c.json(await hit.value)
  const value = findLinkedPrs(key)
  linkedCache.set(key, { at: Date.now(), value })
  value.catch(() => linkedCache.delete(key))
  return c.json(await value)
})

// ---------- Jira transitions ----------
api.get('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  return c.json(await getTransitions(cfg, c.req.param('key')))
})

api.post('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  const { id } = await c.req.json<{ id: string }>()
  const key = c.req.param('key')
  const updated = await transition(cfg, key, id)
  const all = listJira()
  const prev = all.find((i) => i.key === key)
  replaceJira(
    all.map((i) => (i.key === key ? { ...updated, isMine: prev?.isMine ?? false } : i)),
    new Date().toISOString(),
  )
  return c.json(updated)
})
// ---------- Jira composer ----------

const FieldValue = z.union([z.string(), z.array(z.string()), z.number(), z.null()])

/** The projects chosen in Settings → Jira (all when none are chosen) */
api.get('/jira/projects', async (c) => c.json(await listProjects(jiraCfg())))

api.get('/jira/meta', async (c) => {
  const project = c.req.query('project')
  if (!project) throw bad('project is required')
  return c.json(await createMeta(jiraCfg(), project, c.req.query('type') || undefined))
})

api.get('/jira/options', async (c) => {
  const { kind, project, q, issue, field } = c.req.query()
  if (!kind || !project) throw bad('kind and project are required')
  return c.json(await fieldOptions(jiraCfg(), kind as JiraFieldKind, { project, q, issueKey: issue || undefined, field }))
})

/** A copy-paste prompt for an AI agent to implement the issue, with links to all its context */
api.get('/jira/:key/agent-prompt', async (c) => c.json({ prompt: await buildAgentPrompt(c.req.param('key')) }))

api.get('/jira/:key/editable', async (c) => c.json(await editable(jiraCfg(), c.req.param('key'))))

api.post('/jira/issues', async (c) => {
  const input = z
    .object({
      projectKey: z.string().min(1),
      issueTypeId: z.string().min(1),
      summary: z.string().trim().min(1),
      description: z.string().default(''),
      values: z.record(z.string(), FieldValue).default({}),
      slackItemId: z.string().nullish(),
      replyInThread: z.boolean().default(false),
      attachments: Images,
    })
    .parse(await c.req.json())
  const s = getSettings()
  const item = input.slackItemId ? getSlackItem(input.slackItemId) : null
  // Created from Slack: a link back to the message at the end of the description
  const description = item?.permalink ? `${input.description.trim()}\n\n---\nSource: [Slack message from ${item.userName}](${item.permalink})` : input.description
  // Images in the description are uploaded after the issue exists, then linked into it
  const inline = hasAttachmentRefs(description)
  let issue = await composeCreate(jiraCfg(), { ...input, description: inline ? resolveAttachmentRefs(description, []) : description })
  // The issue exists even if an upload fails: report it instead of failing the create
  let attachError: string | null = null
  try {
    const uploaded = await addAttachments(jiraCfg(), issue.key, input.attachments)
    if (inline && uploaded.length) issue = await composeUpdate(jiraCfg(), issue.key, { description: resolveAttachmentRefs(description, uploaded) })
  } catch (e) {
    attachError = (e as Error).message
  }
  upsertJira({ ...issue, isMine: issue.assignee?.accountId === (await jiraMyself(jiraCfg()).catch(() => null))?.accountId })
  let replied = false
  if (item) {
    setSlackStatus(item.id, 'done', issue.key)
    if (input.replyInThread && s.slack?.token) {
      await replyInThread(s.slack, item, `Tracked in Jira: <${issue.url}|${issue.key}> – ${issue.summary}`)
      replied = true
    }
  }
  return c.json({ ...issue, replied, attachError })
})

/** Claude writes (or reworks) the issue in the composer, from your request, the context and the writing guides */
api.post('/jira/draft', async (c) => {
  const s = getSettings()
  const cfg = jiraCfg()
  const input = z
    .object({
      projectKey: z.string().min(1),
      issueTypeId: z.string(),
      fieldKeys: z.array(z.string()).default([]),
      prompt: z.string().default(''),
      current: z.object({ summary: z.string(), description: z.string(), values: z.record(z.string(), FieldValue) }),
      context: z.object({ prId: z.string().nullish(), slackItemId: z.string().nullish(), repo: z.string().nullish() }).default({}),
      images: Images,
      issueKey: z.string().nullish(),
    })
    .parse(await c.req.json())
  if (!input.prompt.trim()) throw bad('Tell Claude what to write or change')
  // Stop Claude when the browser cancels (Stop button) or goes away
  const stop = new AbortController()
  const out = (c.env as { outgoing?: import('node:http').ServerResponse } | undefined)?.outgoing
  out?.on('close', () => !out.writableFinished && stop.abort())
  c.req.raw.signal?.addEventListener('abort', () => stop.abort(), { once: true })
  // Editing: the issue's own editable fields and types; creating: the project's create fields
  const meta = input.issueKey
    ? await editable(cfg, input.issueKey).then((e) => ({ fields: e.fields, issueTypes: e.issueTypes, issueTypeId: input.issueTypeId || e.issueTypeId }))
    : await createMeta(cfg, input.projectKey, input.issueTypeId || undefined)
  const fields = meta.fields.filter((f) => input.fieldKeys.includes(f.key))
  // Choices for fields searched on Jira: open epics for parent, the board's active and future sprints
  const choices: Record<string, JiraFieldOption[]> = Object.fromEntries(
    await Promise.all(
      fields
        .filter((f) => f.kind === 'parent' || f.kind === 'sprint')
        .map(async (f) => [f.key, await fieldOptions(cfg, f.kind, { project: input.projectKey }).catch(() => [])] as const),
    ),
  )

  // Context: a PR (description and changed files), a Slack thread, the repo's CLAUDE.md
  const accounts = s.github.accounts.filter((a) => a.token)
  const stored = input.context.prId ? listPrs().find((p) => p.pr.id === input.context.prId)?.pr : undefined
  const pr = stored
    ? {
        id: stored.id,
        title: stored.title,
        branch: stored.headRef,
        body: stored.body,
        files: await (async () => {
          const acc = accounts.find((a) => a.id === stored.accountId) ?? accountForOwner(accounts, stored.owner)
          return acc ? prFileNames(acc, stored.repo, stored.number).catch(() => []) : []
        })(),
      }
    : null
  const item = input.context.slackItemId ? getSlackItem(input.context.slackItemId) : null
  const slack = item && s.slack?.token ? { channel: item.channelName, permalink: item.permalink, thread: await threadContext(s.slack, item) } : null
  const repo = input.context.repo || stored?.repo || null
  const claudeMd = repo ? await claudeMdGuide(repo).catch(() => null) : null
  const guide = cfg.guides?.[input.projectKey]?.trim() || null
  // Editing: the latest comments and the PRs that name this issue
  const issue = input.issueKey
    ? await (async () => {
        const key = input.issueKey!
        const detail = await getIssueDetail(cfg, key, 8).catch(() => null)
        const named = new RegExp(`\\b${key.replace('-', '\\-')}\\b`, 'i')
        const prs = listPrs()
          .map((p) => p.pr)
          .filter((p) => named.test(`${p.title} ${p.headRef} ${p.body}`))
          .slice(0, 4)
          .map((p) => ({ id: p.id, title: p.title, body: p.body }))
        return {
          key,
          comments: (detail?.comments ?? []).map((c) => ({ author: c.author, created: c.created, body: adfToMarkdown(c.body) })),
          prs,
        }
      })()
    : null

  const draft = await draftJiraIssue(s.ai, {
    projectKey: input.projectKey,
    issueTypes: meta.issueTypes.filter((t) => !t.subtask),
    issueTypeId: meta.issueTypeId,
    fields,
    choices,
    prompt: input.prompt,
    current: input.current,
    guide,
    claudeMd: repo && claudeMd ? { repo, text: claudeMd } : null,
    pr,
    slack,
    images: input.images,
    issue,
  }, stop.signal)
  return c.json({
    ...draft,
    used: { guide: !!guide, claudeMd: claudeMd ? repo : null, pr: pr?.id ?? null, slack: !!slack, comments: issue?.comments.length ?? 0, linkedPrs: issue?.prs.length ?? 0 },
  })
})

api.put('/jira/issues/:key', async (c) => {
  const changes = z
    .object({
      summary: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      issueTypeId: z.string().optional(),
      values: z.record(z.string(), FieldValue).optional(),
      attachments: Images,
      /** Markdown comment posted with the change (e.g. what Claude changed) */
      comment: z.string().optional(),
    })
    .parse(await c.req.json())
  const { attachments, comment, ...fieldChanges } = changes
  // Upload first, so images in the new description can point at them
  const uploaded = await addAttachments(jiraCfg(), c.req.param('key'), attachments)
  if (fieldChanges.description !== undefined && hasAttachmentRefs(fieldChanges.description))
    fieldChanges.description = resolveAttachmentRefs(fieldChanges.description, uploaded)
  const issue = await composeUpdate(jiraCfg(), c.req.param('key'), fieldChanges)
  if (comment?.trim()) await addComment(jiraCfg(), c.req.param('key'), comment)
  upsertJira(issue)
  return c.json(issue)
})
