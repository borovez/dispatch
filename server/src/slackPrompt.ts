import type { SlackItem, SlackMessage } from '../../shared/types.ts'
import { getSettings } from './db.ts'
import { buildOverview } from './model.ts'
import { extractJiraKeys, normaliseRef } from './refs.ts'
import { messagesAround } from './slack.ts'

/** Most messages a prompt takes on either side of the item */
const MAX = 200

/**
 * A Markdown brief for pasting into any AI chat: where a Slack message was posted, the conversation around
 * it (a thread reply: the whole thread; a channel or DM message: `before` / `after` messages around it plus
 * its own thread replies), and the PRs and Jira issues the conversation names, as Dispatch knows them.
 * No AI call.
 */
export async function buildSlackPrompt(item: SlackItem, before = 20, after = 20): Promise<string> {
  const s = getSettings()
  if (!s.slack?.token) throw new Error('Slack is not connected')
  const clamp = (n: number) => Math.min(MAX, Math.max(0, n))
  const inThread = !!item.threadTs
  const around = await messagesAround(s.slack, item, inThread ? MAX : clamp(before), inThread ? MAX : clamp(after))
  // A channel/DM message can have its own thread: take it too
  const replies = inThread
    ? []
    : await messagesAround(s.slack, { ...item, threadTs: item.ts }, 0, MAX)
        .then((r) => r.messages.filter((m) => !m.isTarget))
        .catch(() => [] as SlackMessage[])

  const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')
  const indent = (text: string) => text.trim().split('\n').join('\n  ')
  const line = (m: SlackMessage) => `- **${m.userName}** (${when(m.postedAt)})${m.isTarget ? ' ★ *the message in question*' : ''}:\n  ${indent(m.text) || '_(no text)_'}`

  // What the conversation names, as Dispatch knows it
  const all = [...around.messages, ...replies]
  const texts = all.map((m) => m.text)
  const o = buildOverview()
  const base = (o.jiraBaseUrl ?? s.jira?.baseUrl ?? '').replace(/\/+$/, '')
  const keys = [...new Set([...(item.jiraKey ? [item.jiraKey] : []), ...extractJiraKeys(texts, [])])]
  const jira = keys.map((k) => {
    const j = o.jira.find((x) => x.key === k)
    const link = base ? `[${k}](${base}/browse/${k})` : k
    return j ? `- ${link}: ${j.summary} (${[j.type, j.status, j.assignee?.displayName].filter(Boolean).join(', ')})` : `- ${link}`
  })
  const refs = new Set<string>()
  for (const t of texts) for (const m of t.matchAll(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|\b[\w.-]+\/[\w.-]+#\d+/g)) {
    const id = normaliseRef(m[0])
    if (id) refs.add(id)
  }
  const prs = [...refs].map((id) => {
    const p = o.prs.find((x) => x.id === id)
    if (!p) return `- ${id}`
    const state = p.state === 'OPEN' ? (p.isDraft ? 'draft' : 'open') : p.state.toLowerCase()
    return `- [${p.id}](${p.url}): ${p.title} (${state}, by ${p.author.login})`
  })

  const where = item.channelName.startsWith('#') ? `the ${item.channelName} channel` : item.channelName === 'DM' ? `a DM with ${item.userName}` : /^group dm$/i.test(item.channelName) ? 'a group DM' : `a group DM (${item.channelName})`
  const out = [
    `# Slack conversation: ${item.channelName}`,
    '',
    `Context from Slack, from ${where}${inThread ? ', in a thread' : ''}. The message marked ★ is the one in question (from ${item.userName}, ${when(item.postedAt)}).${item.permalink ? ` Link: ${item.permalink}` : ''}`,
    '',
    `Participants: ${[...new Set(all.map((m) => m.userName))].join(', ')}`,
    '',
    `## ${inThread ? 'Thread' : 'Conversation'}`,
    '',
    ...(around.hasBefore ? ['_(earlier messages not included)_', ''] : []),
    ...around.messages.map(line),
    ...(around.hasAfter ? ['', '_(later messages not included)_'] : []),
  ]
  if (replies.length) out.push('', '## Replies in its thread', '', ...replies.map(line))
  if (prs.length) out.push('', '## Pull requests mentioned', '', ...prs)
  if (jira.length) out.push('', '## Jira issues mentioned', '', ...jira)
  return out.join('\n') + '\n'
}
