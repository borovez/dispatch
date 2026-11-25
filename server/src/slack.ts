import type { SlackConfig, SlackContext, SlackItem, SlackKind, SlackFile, SlackMessage, SlackUserProfile } from '../../shared/types.ts'
import { getSlackUsers, kvGet, kvSet, saveSlackUsers } from './db.ts'

// Slack Web API with a *user* token (xoxp-). Required user scopes:
//   search:read, im:history, mpim:history, im:read, mpim:read, channels:history,
//   groups:history, users:read, chat:write (replies), users:read.email (emails on profile cards)

export class SlackError extends Error {
  constructor(
    message: string,
    /** Slack's error code, e.g. channel_not_found */
    public code?: string,
  ) {
    super(message)
  }
}

/** A DM or group we can't read (deactivated user, external Slack Connect DM…): skip it, not a sync error */
const UNREADABLE = new Set(['channel_not_found', 'not_in_channel', 'is_archived', 'access_denied', 'method_not_supported_for_channel_type'])

async function call<T = any>(token: string, method: string, params: Record<string, string | number | undefined> = {}, attempt = 0): Promise<T> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v))
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('retry-after') ?? '5')
    await new Promise((r) => setTimeout(r, wait * 1000))
    return call(token, method, params, attempt + 1)
  }
  const json = (await res.json()) as { ok: boolean; error?: string; needed?: string }
  if (!json.ok) throw new SlackError(`Slack ${method}: ${json.error}${json.needed ? ` (needs scope ${json.needed})` : ''}`, json.error)
  return json as T
}

export async function slackAuthTest(token: string) {
  const r = await call<{ user_id: string; user: string; team: string; url: string }>(token, 'auth.test')
  return { userId: r.user_id, user: r.user, team: r.team, url: r.url }
}

// ---------- users ----------
async function resolveUsers(token: string, ids: Iterable<string>) {
  const cache = getSlackUsers()
  const missing = [...new Set(ids)].filter((id) => id && !cache[id])
  await pool(missing, 4, async (id) => {
    try {
      const r = await call(token, 'users.info', { user: id })
      cache[id] = {
        name: r.user.profile?.display_name || r.user.real_name || r.user.name,
        avatar: r.user.profile?.image_48 ?? null,
      }
    } catch {
      cache[id] = { name: id, avatar: null }
    }
  })
  if (missing.length) saveSlackUsers(cache)
  return cache
}

/** Channel id → "#name" / "DM" / "Group DM", cached for the life of the process */
const channelNames = new Map<string, string>()
async function resolveChannelNames(token: string, ids: string[]) {
  await pool([...new Set(ids)].filter((id) => !channelNames.has(id)), 4, async (id) => {
    try {
      const c = (await call(token, 'conversations.info', { channel: id })).channel
      channelNames.set(id, c.is_im ? 'DM' : c.is_mpim ? 'Group DM' : `#${c.name}`)
    } catch {
      // Usually a private channel without channels:read / groups:read; don't retry every sync
      channelNames.set(id, id.startsWith('D') ? 'DM' : 'Private channel')
    }
  })
  return channelNames
}

/** Keep Slack mrkdwn but name user mentions: <@U1> → <@U1|Name>, for the client to format */
export const namedMentions = (text: string, users: Record<string, { name: string }>) =>
  text.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `<@${id}|${users[id]?.name ?? id}>`)

/** Slack mrkdwn → readable text: <@U1>, <#C1|name>, <url|label>, entities. */
export function renderText(text: string, users: Record<string, { name: string }>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${users[id]?.name ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  }))
}

const tsToIso = (ts: string) => new Date(Number(ts.split('.')[0]) * 1000).toISOString()

export interface SlackFetchResult {
  items: { item: SlackItem; autoDone: boolean }[]
  errors: string[]
  /** Kinds whose source was read successfully – stale open items of these kinds can be closed */
  completeKinds: SlackKind[]
  /** DMs / group DMs read this sync → ts of the one message awaiting my reply there ('' when none) */
  awaiting: Map<string, string>
}

/**
 * Collects what needs my attention:
 *  - messages that @-mention me anywhere (search.messages)
 *  - DMs and group DMs where someone wrote after my last reply
 */
export async function fetchSlackInbox(cfg: SlackConfig): Promise<SlackFetchResult> {
  const errors: string[] = []
  const me = cfg.userId ?? (await slackAuthTest(cfg.token)).userId
  const since = new Date(Date.now() - cfg.lookbackDays * 86400_000)
  const oldest = String(Math.floor(since.getTime() / 1000))
  const raw: { kind: SlackKind; channelId: string; channelName: string; m: any; awaitingReply: boolean; autoDone: boolean; permalink: string | null }[] = []

  // 1. Mentions
  try {
    const r = await call(cfg.token, 'search.messages', {
      query: `<@${me}> after:${since.toISOString().slice(0, 10)}`,
      sort: 'timestamp',
      sort_dir: 'desc',
      count: 100,
    })
    for (const m of r.messages?.matches ?? []) {
      if (m.user === me) continue
      const ch = m.channel ?? {}
      const kind: SlackKind = ch.is_im ? 'dm' : ch.is_mpim ? 'group' : 'mention'
      const threadTs = /thread_ts=([\d.]+)/.exec(m.permalink ?? '')?.[1] ?? null
      raw.push({
        kind,
        channelId: ch.id,
        channelName: ch.is_im ? 'DM' : ch.is_mpim ? 'Group DM' : `#${ch.name}`,
        m: { ...m, thread_ts: m.thread_ts ?? threadTs },
        awaitingReply: false,
        autoDone: false,
        permalink: m.permalink ?? null,
      })
    }
  } catch (e) {
    errors.push((e as Error).message)
  }

  const completeKinds: SlackKind[] = []
  const awaiting = new Map<string, string>()
  const channelLabel = (ch: string, isIm?: boolean, isMpim?: boolean, name?: string) =>
    isIm || ch.startsWith('D') ? 'DM' : isMpim || name?.startsWith('mpdm-') ? 'Group DM' : name ? `#${name}` : ch

  // 2a. Saved / bookmarked ("Later") messages – no lookback, they stay until unsaved
  if (cfg.includeSaved) {
    try {
      const r = await call(cfg.token, 'stars.list', { count: 200 }).catch((e) => {
        if (e instanceof SlackError && e.code === 'missing_scope')
          throw new SlackError('Saved messages need the stars:read scope: add it to your Slack app, reinstall, and paste the new token in Settings → Slack. Or turn off "Include saved messages".', e.code)
        throw e
      })
      for (const it of r.items ?? []) {
        if (it.type !== 'message' || !it.message) continue
        const m = it.message
        raw.push({
          kind: 'saved',
          channelId: it.channel,
          channelName: channelLabel(it.channel, undefined, undefined, m.channel_name),
          m,
          awaitingReply: false,
          autoDone: false,
          permalink: m.permalink ?? null,
        })
      }
      completeKinds.push('saved')
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  // 2b. Messages I marked with a todo reaction
  if (cfg.todoReactions?.length) {
    try {
      const clean = (list: string[] = []) => new Set(list.map((x) => x.replace(/:/g, '').trim()).filter(Boolean))
      const wanted = clean(cfg.todoReactions)
      const done = clean(cfg.doneReactions)
      const r = await call(cfg.token, 'reactions.list', { user: me, full: 'true', count: 200 })
      for (const it of r.items ?? []) {
        if (it.type !== 'message' || !it.message) continue
        const m = it.message
        const mineWith = (names: Set<string>) => (m.reactions ?? []).some((x: any) => names.has(x.name) && (x.users ?? []).includes(me))
        if (!mineWith(wanted)) continue
        raw.push({
          kind: 'todo',
          channelId: it.channel,
          channelName: channelLabel(it.channel, undefined, undefined, m.channel_name),
          m,
          awaitingReply: false,
          // Also reacted with a "done" emoji: completed
          autoDone: mineWith(done),
          permalink: m.permalink ?? null,
        })
      }
      completeKinds.push('todo')
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  // 3. DMs and group DMs: messages after my last message
  try {
    const convs: any[] = []
    let cursor: string | undefined
    do {
      const r = await call(cfg.token, 'users.conversations', { types: 'im,mpim', exclude_archived: 'true', limit: 200, cursor })
      convs.push(...r.channels)
      cursor = r.response_metadata?.next_cursor || undefined
    } while (cursor && convs.length < 1000)

    // most recently active first when Slack gives us `updated`, otherwise newest conversations first
    convs.sort((a, b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0))
    await pool(convs.slice(0, cfg.maxConversations), 3, async (c) => {
      try {
        const h = await call(cfg.token, 'conversations.history', { channel: c.id, oldest, limit: 20 })
        const msgs: any[] = (h.messages ?? []).filter((m: any) => !m.subtype || m.subtype === 'thread_broadcast')
        if (!msgs.length) return
        // history is newest first
        const lastMine = msgs.findIndex((m) => m.user === me)
        const unanswered = lastMine === -1 ? msgs : msgs.slice(0, lastMine)
        const answered = lastMine === -1 ? [] : msgs.slice(lastMine + 1)
        const kind: SlackKind = c.is_im ? 'dm' : 'group'
        // One item per conversation: the latest message since my last one (the panel shows the rest)
        const latest = unanswered[0]
        awaiting.set(c.id, latest?.ts ?? '')
        if (latest) raw.push({ kind, channelId: c.id, channelName: kind === 'dm' ? 'DM' : 'Group DM', m: latest, awaitingReply: true, autoDone: false, permalink: null })
        // I replied after these – close them if they were still open
        for (const m of answered.filter((x) => x.user !== me).slice(0, 5))
          raw.push({ kind, channelId: c.id, channelName: kind === 'dm' ? 'DM' : 'Group DM', m, awaitingReply: false, autoDone: true, permalink: null })
      } catch (e) {
        if (!(e instanceof SlackError && e.code && UNREADABLE.has(e.code))) errors.push((e as Error).message)
      }
    })
  } catch (e) {
    errors.push((e as Error).message)
  }

  const users = await resolveUsers(
    cfg.token,
    raw.flatMap((r) => [r.m.user, ...[...String(r.m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  // Some sources (todo reactions, saved items) only give a channel id: look the names up
  const names = await resolveChannelNames(cfg.token, raw.filter((r) => r.channelName === r.channelId).map((r) => r.channelId))
  for (const r of raw) if (r.channelName === r.channelId && names.has(r.channelId)) r.channelName = names.get(r.channelId)!

  const base = (cfg.teamUrl ?? '').replace(/\/+$/, '')
  const items = new Map<string, { item: SlackItem; autoDone: boolean }>()
  // saved/todo first so they win over a plain mention of the same message
  raw.sort((a, b) => Number(['saved', 'todo'].includes(b.kind)) - Number(['saved', 'todo'].includes(a.kind)))
  for (const r of raw) {
    const id = `${r.channelId}:${r.m.ts}`
    if (items.has(id) && !r.autoDone) continue
    const u = users[r.m.user]
    items.set(id, {
      autoDone: r.autoDone,
      item: {
        id,
        channelId: r.channelId,
        channelName: r.channelName,
        kind: r.kind,
        ts: r.m.ts,
        threadTs: r.m.thread_ts && r.m.thread_ts !== r.m.ts ? r.m.thread_ts : null,
        user: r.m.user,
        userName: u?.name ?? r.m.username ?? r.m.user,
        userAvatar: u?.avatar ?? null,
        text: renderText(r.m.text ?? '', users),
        rich: namedMentions(r.m.text ?? '', users),
        permalink: r.permalink ?? (base ? `${base}/archives/${r.channelId}/p${r.m.ts.replace('.', '')}` : null),
        postedAt: tsToIso(r.m.ts),
        awaitingReply: r.awaitingReply,
        status: 'new',
        jiraKey: null,
        pinned: false,
        ...(attachmentNames(r.m.files).length ? { attachments: attachmentNames(r.m.files) } : {}),
      },
    })
  }
  return { items: [...items.values()], errors, completeKinds, awaiting }
}

/** Full thread (or surrounding messages) as plain text, for drafting a ticket. */
export async function threadContext(cfg: SlackConfig, item: SlackItem): Promise<string> {
  let msgs: any[] = []
  try {
    const r = await call(cfg.token, 'conversations.replies', { channel: item.channelId, ts: item.threadTs ?? item.ts, limit: 60 })
    msgs = r.messages ?? []
  } catch {
    /* not a thread or no access */
  }
  if (msgs.length <= 1) {
    // No thread: take the conversation around the message
    try {
      const r = await call(cfg.token, 'conversations.history', { channel: item.channelId, latest: item.ts, inclusive: 'true', limit: 15 })
      msgs = (r.messages ?? []).reverse()
    } catch {
      msgs = [{ user: item.user, text: item.text, ts: item.ts }]
    }
  }
  const users = await resolveUsers(
    cfg.token,
    msgs.flatMap((m) => [m.user, ...[...String(m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  return msgs
    .map((m) => `[${tsToIso(m.ts).slice(0, 16).replace('T', ' ')}] ${users[m.user]?.name ?? m.user}${m.ts === item.ts ? ' (★ the message in question)' : ''}: ${renderText(m.text ?? '', users)}`)
    .join('\n')
}

/**
 * Up to `before` / `after` messages around an inbox item, oldest first, and whether there are more.
 * A thread reply gets its neighbours in the thread; anything else gets its neighbours in the channel
 * or DM ("after" looks up to 30 days ahead).
 */
export async function messagesAround(cfg: SlackConfig, item: SlackItem, before = 2, after = 2): Promise<SlackContext> {
  const visible = (m: any) => !m.subtype || m.subtype === 'thread_broadcast' || m.subtype === 'bot_message' || m.subtype === 'file_share'
  let msgs: any[]
  if (item.threadTs) {
    const r = await call(cfg.token, 'conversations.replies', { channel: item.channelId, ts: item.threadTs, limit: 200 })
    msgs = (r.messages ?? []).filter(visible) // oldest first, parent included
  } else {
    // History is newest first. Before: up to the item (one extra, plus slack for hidden subtypes, tells us
    // if there's more). After: a 30-day window from the item, keeping the oldest.
    const [older, newer] = await Promise.all([
      call(cfg.token, 'conversations.history', { channel: item.channelId, latest: item.ts, inclusive: 'true', limit: before + 10 }),
      call(cfg.token, 'conversations.history', { channel: item.channelId, oldest: item.ts, latest: String(Number(item.ts) + 30 * 86400), limit: 200 }),
    ])
    const prev = (older.messages ?? []).filter(visible).reverse() // oldest first, ends with the item
    const next = (newer.messages ?? []).filter(visible).reverse().filter((m: any) => m.ts !== item.ts) // oldest first
    msgs = [...prev, ...next]
    // Fetched windows can end before the conversation does
    if (older.has_more) msgs.unshift({ ts: '0', placeholder: true })
    if (newer.has_more) msgs.push({ ts: '9', placeholder: true })
  }
  let i = msgs.findIndex((m) => m.ts === item.ts)
  if (i < 0) {
    // Deleted or not visible: show the item on its own
    msgs = [{ ts: item.ts, user: item.user, text: item.text }]
    i = 0
  }
  const from = Math.max(0, i - before)
  const to = i + after + 1
  const hasBefore = from > 0
  const hasAfter = to < msgs.length
  const window = msgs.slice(from, to).filter((m) => !m.placeholder)
  const users = await resolveUsers(
    cfg.token,
    window.flatMap((m) => [m.user, ...[...String(m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  const me = await myUserId(cfg).catch(() => null)
  const messages = window.map((m) => ({
    ts: m.ts,
    user: m.user ?? '',
    userName: users[m.user]?.name ?? m.username ?? m.user ?? 'Unknown',
    userAvatar: users[m.user]?.avatar ?? null,
    text: renderText(m.text ?? '', users),
    rich: namedMentions(m.text ?? '', users),
    postedAt: tsToIso(m.ts),
    isTarget: m.ts === item.ts,
    ...(me && m.user === me ? { mine: true } : {}),
    ...(!item.threadTs && m.reply_count ? { replyCount: Number(m.reply_count) } : {}),
    ...(m.files?.length ? { files: slackFiles(m.files) } : {}),
  }))
  return { messages, hasBefore, hasAfter }
}

/** Names of a message's files (deleted / hidden ones left out), for the inbox row */
function attachmentNames(files: any[] | undefined): string[] {
  return (files ?? []).filter((f) => f?.id && f.mode !== 'tombstone' && !f.hidden_by_limit).map((f) => String(f.title || f.name || 'File'))
}

/** Slack's file objects as shown in the panel: deleted and hidden ones left out, previews through `/api/slack/file` */
function slackFiles(files: any[]): SlackFile[] {
  return files
    .filter((f) => f?.id && f.mode !== 'tombstone' && !f.hidden_by_limit)
    .map((f) => {
      // The largest preview up to 720 px (images, PDFs and other documents Slack renders)
      const size = [720, 480, 360].find((n) => f[`thumb_${n}`])
      const url: string | undefined = size ? f[`thumb_${size}`] : f.thumb_pdf
      return {
        id: String(f.id),
        name: String(f.title || f.name || 'File'),
        filetype: String(f.filetype ?? ''),
        mimetype: String(f.mimetype ?? ''),
        size: typeof f.size === 'number' ? f.size : null,
        thumb: url && isSlackFileUrl(url) ? `/api/slack/file?url=${encodeURIComponent(url)}` : null,
        thumbWidth: size ? (Number(f[`thumb_${size}_w`]) || null) : (Number(f.thumb_pdf_w) || null),
        thumbHeight: size ? (Number(f[`thumb_${size}_h`]) || null) : (Number(f.thumb_pdf_h) || null),
        permalink: f.permalink ?? null,
      }
    })
}

/** Only Slack's own file host gets the token */
export function isSlackFileUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'files.slack.com'
  } catch {
    return false
  }
}

/**
 * A private Slack file (a thumbnail) fetched with the token (needs files:read). Without the scope Slack answers
 * with its sign-in page instead, so anything that isn't an image is refused.
 */
export async function fetchSlackFile(cfg: SlackConfig, url: string): Promise<{ body: ArrayBuffer; type: string }> {
  if (!isSlackFileUrl(url)) throw new Error('Not a Slack file')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` }, redirect: 'manual' })
  const type = res.headers.get('content-type') ?? ''
  // Without files:read Slack redirects to its sign-in page (or answers it directly)
  const signIn = (res.status >= 300 && res.status < 400) || (res.ok && !type.startsWith('image/'))
  if (signIn) throw new Error('Slack file: needs scope files:read')
  if (!res.ok) throw new Error(`Slack file: ${res.status}`)
  return { body: await res.arrayBuffer(), type }
}

/** The replies in a message's thread (parent left out), oldest first */
export async function threadReplies(cfg: SlackConfig, item: SlackItem, ts: string, max = 200): Promise<SlackMessage[]> {
  const r = await messagesAround(cfg, { ...item, ts, threadTs: ts }, 0, max)
  return r.messages.filter((m) => m.ts !== ts).map((m) => ({ ...m, isTarget: m.ts === item.ts }))
}

/**
 * Post a message to the item's conversation as me: in a thread when `threadTs` is given (a message's own ts
 * starts its thread), else straight into the channel or DM. Needs chat:write.
 */
export async function postMessage(cfg: SlackConfig, item: SlackItem, text: string, threadTs?: string | null): Promise<string> {
  const r = await call<{ ts: string }>(cfg.token, 'chat.postMessage', { channel: item.channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) })
  return r.ts
}

/** The connected user's id: from settings, else asked once per token */
const meByToken = new Map<string, Promise<string>>()
export function myUserId(cfg: SlackConfig): Promise<string> {
  if (cfg.userId) return Promise.resolve(cfg.userId)
  let p = meByToken.get(cfg.token)
  if (!p) {
    p = slackAuthTest(cfg.token).then((r) => r.userId)
    p.catch(() => meByToken.delete(cfg.token))
    meByToken.set(cfg.token, p)
  }
  return p
}

/**
 * Delete one of my messages in the item's conversation (chat:write). Refuses anyone else's, even when the
 * token could (a workspace admin's can): the message is read back first and must be mine.
 */
export async function deleteMessage(cfg: SlackConfig, item: SlackItem, ts: string): Promise<void> {
  const [me, r] = await Promise.all([myUserId(cfg), call<{ messages?: { ts: string; user?: string }[] }>(cfg.token, 'conversations.replies', { channel: item.channelId, ts, limit: 1 })])
  const m = r.messages?.find((x) => x.ts === ts)
  if (!m) throw new SlackError('Slack: that message is gone already', 'message_not_found')
  if (m.user !== me) throw new SlackError('Only your own messages can be deleted', 'cant_delete_message')
  await call(cfg.token, 'chat.delete', { channel: item.channelId, ts })
}

/** The workspace's URL (https://x.slack.com/) and id, for profile links; asked once per process */
let team: Promise<{ url: string; id: string }> | null = null
const teamInfo = (token: string) =>
  (team ??= call<{ url: string; team_id: string }>(token, 'auth.test')
    .then((r) => ({ url: r.url, id: r.team_id }))
    .catch((e) => {
      team = null
      throw e
    }))

/** A user's profile card: names, title, email (users:read.email) and links to their profile and a DM */
export async function userProfile(cfg: SlackConfig, id: string): Promise<SlackUserProfile> {
  const [r, t] = await Promise.all([call(cfg.token, 'users.info', { user: id }), teamInfo(cfg.token).catch(() => null)])
  const u = r.user
  const p = u.profile ?? {}
  return {
    id,
    name: p.display_name || u.real_name || u.name,
    realName: p.real_name || u.real_name || null,
    title: p.title || null,
    email: p.email || null,
    avatar: p.image_192 ?? p.image_72 ?? p.image_48 ?? null,
    profileUrl: t ? `${t.url.replace(/\/?$/, '/')}team/${id}` : null,
    dmUrl: t ? `slack://user?team=${t.id}&id=${id}` : null,
  }
}

export async function replyInThread(cfg: SlackConfig, item: SlackItem, text: string) {
  await call(cfg.token, 'chat.postMessage', { channel: item.channelId, thread_ts: item.threadTs ?? item.ts, text })
}

/**
 * Mirror Dispatch's Done on a Slack todo: add my first "done" reaction (or take it off when the item goes
 * back to the inbox). Needs the reactions:write scope.
 */
export async function setTodoDoneInSlack(cfg: SlackConfig, item: SlackItem, done: boolean): Promise<string | null> {
  const name = (cfg.doneReactions ?? []).map((x) => x.replace(/:/g, '').trim()).find(Boolean)
  if (!name) return null
  try {
    await call(cfg.token, done ? 'reactions.add' : 'reactions.remove', { channel: item.channelId, timestamp: item.ts, name })
  } catch (e) {
    const code = (e as SlackError).code
    // Already in the wanted state
    if (code !== 'already_reacted' && code !== 'no_reaction') {
      if (code === 'missing_scope')
        throw new SlackError('Marking todos done in Slack needs the reactions:write scope: add it to your Slack app, reinstall, and paste the new token in Settings → Slack.', code)
      throw e
    }
  }
  return name
}

/**
 * The workspace's custom emoji, name → image URL (aliases resolved; an alias of a standard emoji maps to
 * `unicode:<name>`). Needs emoji:read. Kept a day in kv `slackEmoji`; `refresh` asks Slack again.
 */
export async function customEmoji(cfg: SlackConfig, refresh = false): Promise<Record<string, string>> {
  const cached = kvGet<{ at: number; emoji: Record<string, string> } | null>('slackEmoji', null)
  if (!refresh && cached && Date.now() - cached.at < 86_400_000) return cached.emoji
  const r = await call<{ emoji: Record<string, string> }>(cfg.token, 'emoji.list')
  const raw = r.emoji ?? {}
  const emoji: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    let v = value
    // alias:other (possibly a chain, or a standard emoji's name)
    for (let hops = 0; v.startsWith('alias:') && hops < 5; hops++) {
      const target = v.slice(6)
      v = raw[target] ?? `unicode:${target}`
    }
    if (!v.startsWith('alias:')) emoji[name] = v
  }
  kvSet('slackEmoji', { at: Date.now(), emoji })
  return emoji
}
