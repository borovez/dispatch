import { setTodoDoneInSlack } from '../slack.ts'
import { z } from 'zod'
import { getSettings, getSlackItem, setSlackStatus, setSlackPinned } from '../db.ts'
import { buildSlackPrompt } from '../slackPrompt.ts'
import { messagesAround, threadReplies, postMessage, deleteMessage, customEmoji, userProfile, threadContext } from '../slack.ts'
import { syncSlack } from '../sync.ts'
import { api, bad } from './shared.ts'

/** Slack inbox: status, pin, conversation, replies, prompt */
// ---------- Slack inbox ----------
api.put('/slack/:id/status', async (c) => {
  const { status } = await c.req.json<{ status: 'new' | 'done' | 'dismissed' }>()
  const id = c.req.param('id')
  const item = getSlackItem(id)
  setSlackStatus(id, status)
  // Todos (marked with a reaction) get the done reaction in Slack too, or lose it when reopened
  const cfg = getSettings().slack
  if (cfg?.token && item?.kind === 'todo' && status !== 'dismissed' && item.status !== status) {
    try {
      const reaction = await setTodoDoneInSlack(cfg, item, status === 'done')
      return c.json({ ok: true, slack: reaction ? { reaction, done: status === 'done' } : null })
    } catch (e) {
      return c.json({ ok: true, slack: null, warning: (e as Error).message })
    }
  }
  return c.json({ ok: true, slack: null })
})

api.put('/slack/:id/pin', async (c) => {
  const { pinned } = await c.req.json<{ pinned: boolean }>()
  const id = c.req.param('id')
  if (!getSlackItem(id)) return c.json({ error: 'Unknown Slack item' }, 404)
  setSlackPinned(id, !!pinned)
  return c.json({ ok: true })
})

api.get('/slack/:id/thread', async (c) => {
  const cfg = getSettings().slack
  const item = getSlackItem(c.req.param('id'))
  if (!cfg?.token || !item) throw bad('Unknown Slack item')
  return c.text(await threadContext(cfg, item))
})

/** Ask Claude to draft a Jira issue from the Slack message + its thread + my extra context. */
api.get('/slack/:id/around', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const n = (q: string | undefined) => Math.min(50, Math.max(0, Number(q ?? 2) || 0))
  return c.json(await messagesAround(s.slack, item, n(c.req.query('before')), n(c.req.query('after'))))
})

/** A message's thread replies, for expanding it in the conversation view */
api.get('/slack/:id/thread-replies', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  const ts = c.req.query('ts')
  if (!s.slack?.token || !item || !ts) throw bad('Unknown Slack item')
  return c.json(await threadReplies(s.slack, item, ts))
})

/** Reply as me: into a message's thread (`threadTs`) or straight into the conversation */
/** Slack page's refresh: just the Slack inbox, not a full sync */
api.post('/slack/refresh', async (c) => {
  const slack = getSettings().slack
  if (!slack?.token) throw bad('Slack not connected')
  const errors: string[] = []
  const items = await syncSlack(slack, errors)
  return c.json({ items, errors })
})

api.post('/slack/:id/reply', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const body = z.object({ text: z.string().trim().min(1), threadTs: z.string().nullish() }).parse(await c.req.json())
  const ts = await postMessage(s.slack, item, body.text, body.threadTs)
  return c.json({ ok: true, ts })
})

/** Delete one of my messages in the item's conversation (anyone else's is refused) */
api.delete('/slack/:id/messages/:ts', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const ts = c.req.param('ts')
  if (!/^\d+\.\d+$/.test(ts)) throw bad('Bad message ts')
  await deleteMessage(s.slack, item, ts)
  return c.json({ ok: true })
})

/** Custom emoji of the workspace (name → image URL); empty with a note when the token lacks emoji:read */
api.get('/slack/emoji', async (c) => {
  const s = getSettings()
  if (!s.slack?.token) return c.json({ emoji: {}, error: 'Slack not connected' })
  try {
    return c.json({ emoji: await customEmoji(s.slack, c.req.query('refresh') === '1') })
  } catch (e) {
    return c.json({ emoji: {}, error: (e as Error).message })
  }
})

api.get('/slack/users/:id', async (c) => {
  const s = getSettings()
  if (!s.slack?.token) throw bad('Slack is not connected')
  return c.json(await userProfile(s.slack, c.req.param('id')))
})

/** A Markdown brief of the conversation around a Slack item, to paste into any AI chat */
api.get('/slack/:id/prompt', async (c) => {
  const item = getSlackItem(c.req.param('id'))
  if (!item) throw bad('Unknown Slack item')
  const n = (q: string | undefined) => (q === undefined ? undefined : Number(q) || 0)
  return c.json({ prompt: await buildSlackPrompt(item, n(c.req.query('before')), n(c.req.query('after'))) })
})
