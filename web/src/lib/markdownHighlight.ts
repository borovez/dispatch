import { mentionRegex } from '@shared/slackMarkdown'

/**
 * Markdown as styled runs for the live editor (`LiveMarkdownInput`). Every character of the text is in
 * exactly one run, in order, so the editor's DOM text is the Markdown itself and caret offsets are plain
 * string offsets. Formatting marks (**, _, `, ```…) are runs with `mark`; the editor shows them dimmed
 * or hides them. A ``` block's runs share a `block` number (from its opening fence through the newline
 * after its closing one), so the editor can draw the block as one box.
 */
export interface HighlightRun {
  text: string
  class: string
  /** Formatting characters (shown dimmed, or hidden) */
  mark: boolean
  /** Index of the ``` block this run is in, -1 outside one */
  block: number
  /** In a ``` block nothing has closed yet (its fence stays visible while it is being typed) */
  open?: boolean
}

const MARK = 1
const BOLD = 2
const ITALIC = 4
const STRIKE = 8
const CODE = 16
const LINK = 32
const MENTION = 64
const QUOTE = 128
const BULLET = 256
const FENCED = 512
const UNCLOSED = 1024
/** The closing fence (kept apart from the opening one, so an empty block is two runs) */
const CLOSING = 2048

const CLASSES: [number, string][] = [
  [MARK, 'text-muted-foreground/60'],
  [MENTION, 'rounded bg-merged/15 px-0.5 text-merged'],
  [CODE, 'rounded border bg-muted px-1 py-px font-mono text-[0.85em] text-foreground'],
  [LINK, 'text-primary underline decoration-primary/40 underline-offset-2'],
  [BULLET, 'text-primary'],
  [QUOTE, 'text-muted-foreground'],
  [BOLD, 'font-semibold'],
  [ITALIC, 'italic'],
  [STRIKE, 'line-through'],
]
const COLOUR = MARK | MENTION | CODE | LINK | BULLET | QUOTE

function classFor(flags: number): string {
  // Inside a ``` block nothing is formatted (the block itself is styled by the editor)
  if (flags & FENCED) return flags & MARK ? CLASSES[0]![1] : ''
  const out: string[] = []
  let colour = false
  for (const [flag, cls] of CLASSES) {
    if (!(flags & flag)) continue
    // One colour wins (the first in CLASSES); the rest only add shape
    if (flag & COLOUR) {
      if (colour) continue
      colour = true
    }
    out.push(cls)
  }
  return out.join(' ')
}

export function highlightMarkdown(md: string, mentions: string[] = []): HighlightRun[] {
  const flags = new Uint16Array(md.length)
  const blockOf = new Int16Array(md.length).fill(-1)
  const set = (from: number, to: number, f: number) => {
    for (let i = from; i < to; i++) flags[i] |= f
  }
  // Code is taken out first: nothing inside it is formatted (masked with NULs, same length)
  let text = md
  const protect = (from: number, to: number) => {
    text = text.slice(0, from) + '\0'.repeat(to - from) + text.slice(to)
  }
  // ``` blocks: the opening fence line (with its newline) and the closing one (with the newline before
  // it) are marks, so hiding marks leaves just the code. An unclosed block runs to the end.
  let blocks = 0
  for (const m of md.matchAll(/(^|\n)(```[^\n]*(?:\n|$))([\s\S]*?)(\n```[^\S\n]*(?=\n|$)|$)/g)) {
    const open = m.index + m[1]!.length
    const body = open + m[2]!.length
    const close = body + m[3]!.length
    let end = close + m[4]!.length
    if (md[end] === '\n') end++ // the newline after the block belongs to it (no blank line after the box)
    set(open, end, FENCED | (m[4] ? 0 : UNCLOSED))
    set(open, body, MARK)
    set(close, close + m[4]!.length, MARK | CLOSING)
    blockOf.fill(blocks++, open, end)
    // Not the newline after it: the next line still starts a line (a quote, a list…)
    protect(open, close + m[4]!.length)
  }
  for (const m of text.matchAll(/`[^`\n\0]+`/g)) {
    const end = m.index + m[0].length
    set(m.index, m.index + 1, MARK)
    set(m.index + 1, end - 1, CODE)
    set(end - 1, end, MARK)
    protect(m.index, end)
  }

  // Line starts: quotes, bullets, numbers, headings
  let at = 0
  for (const line of text.split('\n')) {
    const quote = /^\s*> ?/.exec(line)
    if (quote) {
      set(at, at + quote[0].length, MARK)
      set(at + quote[0].length, at + line.length, QUOTE)
    }
    const rest = quote ? quote[0].length : 0
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line.slice(rest))
    if (bullet) set(at + rest, at + rest + bullet[0].length, BULLET)
    const heading = /^\s*#{1,6}\s+/.exec(line.slice(rest))
    if (heading) {
      set(at + rest, at + rest + heading[0].length, MARK)
      set(at + rest + heading[0].length, at + line.length, BOLD)
    }
    at += line.length + 1
  }

  // [text](url): the text is the link, the rest marks
  for (const m of text.matchAll(/\[([^\]\n\0]+)\]\(([^)\s\0]+)\)/g)) {
    set(m.index, m.index + 1, MARK)
    set(m.index + 1, m.index + 1 + m[1]!.length, LINK)
    set(m.index + 1 + m[1]!.length, m.index + m[0].length, MARK)
  }
  for (const m of text.matchAll(/(?<![(\w])https?:\/\/[^\s<>\0)]+/g)) set(m.index, m.index + m[0].length, LINK)

  const wrapped = (re: RegExp, marker: number, f: number) => {
    for (const m of text.matchAll(re)) {
      const end = m.index + m[0].length
      set(m.index, m.index + marker, MARK)
      set(m.index + marker, end - marker, f)
      set(end - marker, end, MARK)
    }
  }
  wrapped(/\*\*[^*\n\0]+\*\*|__[^_\n\0]+__/g, 2, BOLD)
  wrapped(/~~[^~\n\0]+~~/g, 2, STRIKE)
  wrapped(/(?<![\w*])\*[^*\n\0]+\*(?![\w*])|(?<![\w_])_[^_\n\0]+_(?![\w_])/g, 1, ITALIC)

  const mention = mentionRegex(mentions)
  if (mention) {
    for (const m of text.matchAll(mention)) {
      const from = m.index + m[1]!.length
      set(from, from + 1 + m[2]!.length, MENTION)
    }
  }

  const runs: HighlightRun[] = []
  let start = 0
  for (let i = 1; i <= md.length; i++) {
    if (i < md.length && flags[i] === flags[start] && blockOf[i] === blockOf[start]) continue
    runs.push({ text: md.slice(start, i), class: classFor(flags[start]!), mark: !!(flags[start]! & MARK), block: blockOf[start]!, ...(flags[start]! & UNCLOSED ? { open: true } : {}) })
    start = i
  }
  return runs
}
