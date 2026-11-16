// Markdown -> Atlassian Document Format (Jira descriptions). Shared so the create dialog previews
// exactly what the server sends: headings, paragraphs, bullet/numbered lists, > quotes, code blocks,
// and inline **bold**, *italic* / _italic_, `code`, [links](url) and bare URLs.

/** Marks we write: strong, em, code, link. Jira's own documents also use strike, underline, textColor… */
export interface AdfMark {
  type: string
  attrs?: { href?: string; [k: string]: unknown }
}
export interface AdfNode {
  type: string
  text?: string
  marks?: AdfMark[]
  attrs?: { level?: number; url?: string; text?: string; shortName?: string; [k: string]: unknown }
  content?: AdfNode[]
}
export interface AdfDoc {
  type: 'doc'
  version: 1
  content: AdfNode[]
}

/** A Jira-hosted file in Markdown: jira-media:<id>?collection=…&width=…&height=… (kept as is when saved back) */
function jiraMediaUrl(attrs: Record<string, unknown>) {
  const q = new URLSearchParams()
  for (const k of ['collection', 'width', 'height']) if (attrs[k] !== undefined && attrs[k] !== '') q.set(k, String(attrs[k]))
  return `jira-media:${String(attrs.id)}${q.size ? `?${q}` : ''}`
}

/** An image's media attributes: a Jira file (jira-media:) or an external / not-yet-uploaded image */
function mediaAttrs(alt: string, url: string): Record<string, unknown> {
  if (!url.startsWith('jira-media:')) return { type: 'external', url, alt }
  const [id, query = ''] = url.slice('jira-media:'.length).split('?')
  const q = new URLSearchParams(query)
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined)
  return Object.fromEntries(
    Object.entries({ type: 'file', id, collection: q.get('collection') ?? '', alt: alt === 'attachment' ? undefined : alt, width: num('width'), height: num('height') }).filter(
      ([, v]) => v !== undefined,
    ),
  )
}

/** Common :shortcode: emoji (GitHub / Slack names); unknown ones stay as typed */
export const EMOJI: Record<string, string> = {
  smile: '😄', smiley: '😃', grin: '😁', joy: '😂', laughing: '😆', wink: '😉', blush: '😊', slightly_smiling_face: '🙂', upside_down_face: '🙃',
  thinking_face: '🤔', thinking: '🤔', sweat_smile: '😅', neutral_face: '😐', confused: '😕', cry: '😢', sob: '😭', scream: '😱', sunglasses: '😎',
  heart: '❤️', blue_heart: '💙', green_heart: '💚', broken_heart: '💔', fire: '🔥', sparkles: '✨', star: '⭐', boom: '💥', zap: '⚡', tada: '🎉',
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', ok_hand: '👌', clap: '👏', raised_hands: '🙌', pray: '🙏', wave: '👋', muscle: '💪',
  point_right: '👉', point_left: '👈', point_up: '☝️', point_down: '👇', eyes: '👀', brain: '🧠', handshake: '🤝', saluting_face: '🫡',
  white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️', x: '❌', negative_squared_cross_mark: '❎', warning: '⚠️',
  no_entry: '⛔', no_entry_sign: '🚫', exclamation: '❗', question: '❓', bangbang: '‼️', information_source: 'ℹ️', red_circle: '🔴',
  large_blue_circle: '🔵', large_green_circle: '🟢', green_circle: '🟢', yellow_circle: '🟡', orange_circle: '🟠', white_circle: '⚪',
  rocket: '🚀', bug: '🐛', wrench: '🔧', hammer: '🔨', hammer_and_wrench: '🛠️', gear: '⚙️', lock: '🔒', unlock: '🔓', key: '🔑',
  memo: '📝', pencil: '📝', pencil2: '✏️', clipboard: '📋', pushpin: '📌', round_pushpin: '📍', link: '🔗', paperclip: '📎', package: '📦',
  books: '📚', book: '📖', bookmark: '🔖', calendar: '📅', date: '📅', hourglass: '⌛', hourglass_flowing_sand: '⏳', alarm_clock: '⏰',
  stopwatch: '⏱️', chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊', mag: '🔍', bulb: '💡', moneybag: '💰',
  dollar: '💵', credit_card: '💳', email: '📧', envelope: '✉️', bell: '🔔', loudspeaker: '📢', mega: '📣', speech_balloon: '💬',
  construction: '🚧', rotating_light: '🚨', recycle: '♻️', arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
  arrows_counterclockwise: '🔄', repeat: '🔁', heavy_plus_sign: '➕', heavy_minus_sign: '➖', 100: '💯', new: '🆕', free: '🆓', up: '🆙',
  cool: '🆒', sos: '🆘', trophy: '🏆', medal: '🏅', dart: '🎯', gift: '🎁', coffee: '☕', beer: '🍺', pizza: '🍕', cake: '🍰',
  sun: '☀️', sunny: '☀️', cloud: '☁️', snowflake: '❄️', umbrella: '☂️', earth_americas: '🌎', globe_with_meridians: '🌐', computer: '💻',
  iphone: '📱', desktop_computer: '🖥️', keyboard: '⌨️', floppy_disk: '💾', cd: '💿', robot: '🤖', ghost: '👻', skull: '💀', poop: '💩',
  see_no_evil: '🙈', facepalm: '🤦', shrug: '🤷', man_shrugging: '🤷‍♂️', woman_shrugging: '🤷‍♀️', party_popper: '🎉', confetti_ball: '🎊',
  checkered_flag: '🏁', triangular_flag_on_post: '🚩', white_flag: '🏳️', label: '🏷️', test_tube: '🧪', microscope: '🔬', shield: '🛡️',
  crossed_fingers: '🤞', hugs: '🤗', heart_eyes: '😍', star_struck: '🤩', partying_face: '🥳', exploding_head: '🤯', melting_face: '🫠',
}
/** :shortcode: → emoji in plain text (code is left alone by the caller); unknown names stay as typed */
export const emojify = (text: string) => text.replace(/:([a-z0-9_+-]+):/gi, (m, name: string) => EMOJI[name.toLowerCase()] ?? m)

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isTableDivider = (l: string) => /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?\|?\s*$/.test(l)
/** Cells of a | a | b | row; \| is a literal pipe */
const tableCells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

export function markdownToAdf(md: string): AdfDoc {
  const inline = (text: string): AdfNode[] => {
    const out: AdfNode[] = []
    // Bare URLs stop before trailing punctuation and closing brackets: "(see https://x.io/a)," links https://x.io/a
    // Italic needs a non-word character around it, so snake_case_names and 2*3*4 stay as they are
    const re = /(\*\*[^*]+\*\*|~~[^~\n]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|(?<![\w*])\*(?![\s*])[^*\n]*[^\s*]\*(?![\w*])|(?<!\w)_(?!\s)[^_\n]*[^\s_]_(?!\w))/g
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push({ type: 'text', text: emojify(text.slice(last, m.index)) })
      const t = m[0]
      if (t.startsWith('**')) out.push({ type: 'text', text: emojify(t.slice(2, -2)), marks: [{ type: 'strong' }] })
      else if (t.startsWith('~~')) out.push({ type: 'text', text: emojify(t.slice(2, -2)), marks: [{ type: 'strike' }] })
      else if (t.startsWith('`')) out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'code' }] })
      else if (t.startsWith('*') || t.startsWith('_')) out.push({ type: 'text', text: emojify(t.slice(1, -1)), marks: [{ type: 'em' }] })
      else if (t.startsWith('[')) {
        const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
        out.push({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
      } else out.push({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href: t } }] })
      last = m.index! + t.length
    }
    if (last < text.length) out.push({ type: 'text', text: emojify(text.slice(last)) })
    return out.length ? out : [{ type: 'text', text: ' ' }]
  }
  const content: AdfNode[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith('```')) {
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] })
      continue
    }
    if (/^\s*>/.test(line)) {
      // A run of "> " lines is one quote; "> " on its own starts a new paragraph inside it
      const paras: string[][] = [[]]
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const q = lines[i].replace(/^\s*>\s?/, '')
        if (q.trim()) paras[paras.length - 1].push(q)
        else if (paras[paras.length - 1].length) paras.push([])
        i++
      }
      i--
      content.push({
        type: 'blockquote',
        content: paras.filter((p) => p.length).map((p) => ({ type: 'paragraph', content: inline(p.join(' ')) })),
      })
      continue
    }
    // An image on its own line: ![alt](url). attachment:name refers to a file uploaded with the issue
    // (the server swaps in its Jira URL); http(s) images are shown from their URL
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim())
    if (img) {
      content.push({ type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: mediaAttrs(img[1], img[2]) }] })
      continue
    }
    // --- / *** / ___ on its own line
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      content.push({ type: 'rule' })
      continue
    }
    // A pipe table: | a | b | then | --- | --- |, then rows
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableCells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) rows.push(tableCells(lines[i++]))
      i--
      const cell = (type: 'tableHeader' | 'tableCell', text: string): AdfNode => ({ type, content: [{ type: 'paragraph', content: inline(text) }] })
      content.push({
        type: 'table',
        content: [
          { type: 'tableRow', content: header.map((c) => cell('tableHeader', c)) },
          ...rows.map((r) => ({ type: 'tableRow', content: header.map((_, k) => cell('tableCell', r[k] ?? '')) })),
        ],
      })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: inline(h[2]) })
      continue
    }
    const listRe = /^\s*([-*]|\d+\.)\s+(.*)$/
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: AdfNode[] = []
      while (i < lines.length && listRe.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(listRe.exec(lines[i])![2]) }] })
        i++
      }
      i--
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items })
      continue
    }
    const para = [line]
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(#|```|\s*>|\s*([-*]|\d+\.)\s|\s*!\[[^\]]*\]\([^)\s]+\)\s*$|\s*([-*_])(\s*\3){2,}\s*$)/.test(lines[i + 1]) &&
      !(isTableRow(lines[i + 1]) && i + 2 < lines.length && isTableDivider(lines[i + 2]))
    )
      para.push(lines[++i])
    content.push({ type: 'paragraph', content: inline(para.join(' ')) })
  }
  return { type: 'doc', version: 1, content }
}

/**
 * ADF → Markdown, for editing an existing Jira description in the composer. Covers what Jira's
 * editor writes for text: headings, paragraphs, lists (nested), quotes and panels, code blocks,
 * rules, tables (as pipe rows), mentions, emoji, smart links, and bold / italic / code / strike /
 * links. Media becomes a placeholder. The composer only sends the description back when you change
 * it, so anything lost here only matters for descriptions you edit.
 */
export function adfToMarkdown(doc: AdfDoc | null | undefined): string {
  if (!doc?.content) return ''
  const inline = (nodes: AdfNode[] = []): string =>
    nodes
      .map((n) => {
        if (n.type === 'hardBreak') return '\n'
        if (n.type === 'mention') return `@${String(n.attrs?.text ?? '').replace(/^@/, '')}`
        if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
        if (n.type === 'inlineCard' || n.type === 'blockCard') return String(n.attrs?.url ?? '')
        if (n.type === 'status') return `[${String(n.attrs?.text ?? '')}]`
        if (n.type === 'date') return new Date(Number(n.attrs?.timestamp)).toISOString().slice(0, 10)
        if (n.type !== 'text') return inline(n.content)
        let t = n.text ?? ''
        const marks = n.marks ?? []
        const link = marks.find((m) => m.type === 'link')?.attrs?.href
        if (marks.some((m) => m.type === 'code')) t = `\`${t}\``
        else {
          if (marks.some((m) => m.type === 'strong')) t = `**${t}**`
          if (marks.some((m) => m.type === 'em')) t = `*${t}*`
          if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`
        }
        return link && link !== n.text ? `[${t}](${link})` : t
      })
      .join('')

  const block = (n: AdfNode, indent = ''): string => {
    switch (n.type) {
      case 'paragraph':
        return indent + inline(n.content).replace(/\n/g, `\n${indent}`)
      case 'heading':
        return `${'#'.repeat(Number(n.attrs?.level ?? 1))} ${inline(n.content)}`
      case 'bulletList':
      case 'orderedList':
        return (n.content ?? [])
          .map((item, i) => {
            const bullet = n.type === 'orderedList' ? `${i + 1}. ` : '- '
            const [first, ...rest] = item.content ?? []
            const head = first ? block(first).trimStart() : ''
            const tail = rest.map((c) => block(c, indent + '  ')).join('\n')
            return `${indent}${bullet}${head}${tail ? `\n${tail}` : ''}`
          })
          .join('\n')
      case 'codeBlock':
        return `${indent}\`\`\`${n.attrs?.language ?? ''}\n${inline(n.content)}\n${indent}\`\`\``
      case 'blockquote':
      case 'panel':
        return (n.content ?? []).map((c) => block(c).replace(/^/gm, '> ')).join('\n>\n')
      case 'rule':
        return '---'
      case 'table':
        return (n.content ?? [])
          .map((row, r) => {
            const cells = (row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c)).join(' ').replace(/\|/g, '\\|'))
            const line = `| ${cells.join(' | ')} |`
            return r === 0 ? `${line}\n|${cells.map(() => ' --- |').join('')}` : line
          })
          .join('\n')
      case 'mediaSingle':
      case 'mediaGroup':
        // Each image on its own line; Jira's own files keep their media id (jira-media:), so saving keeps them
        return (n.content ?? [])
          .filter((c) => c.type === 'media')
          .map((m) => {
            const alt = String(m.attrs?.alt ?? '').replace(/[\[\]]/g, '')
            if (m.attrs?.type === 'external' && m.attrs.url) return `${indent}![${alt}](${String(m.attrs.url)})`
            if (m.attrs?.type === 'file' && m.attrs.id) return `${indent}![${alt || 'attachment'}](${jiraMediaUrl(m.attrs)})`
            return `${indent}[attachment]`
          })
          .join('\n')
      case 'expand':
      case 'nestedExpand':
        return [n.attrs?.title ? `**${n.attrs.title}**` : '', ...(n.content ?? []).map((c) => block(c, indent))].filter(Boolean).join('\n\n')
      default:
        return n.content ? n.content.map((c) => block(c, indent)).join('\n\n') : inline([n])
    }
  }
  return doc.content.map((n) => block(n)).join('\n\n').trim()
}
