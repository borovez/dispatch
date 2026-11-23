import type { Component } from 'vue'
import { PhCode, PhCodeBlock, PhLinkSimple, PhListBullets, PhListNumbers, PhQuotes, PhTextB, PhTextItalic, PhTextStrikethrough } from '@phosphor-icons/vue'

/**
 * Markdown formatting on a textarea selection. Edits go through insertText so the browser's undo
 * history works (one Cmd+Z per action) and `input` fires for v-model. Applying a format to text
 * that already has it removes it.
 */

/**
 * What the helpers edit: a textarea, or anything that acts like one (the live editor, `LiveMarkdownInput`,
 * which brings its own `replaceText` so the edit lands in its own undo history).
 */
export interface TextTarget {
  value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  setSelectionRange(start: number, end: number): void
  focus(): void
  dispatchEvent(e: Event): boolean
  replaceText?(start: number, end: number, text: string): void
}

/** Replace a range, keeping undo history; falls back to setting the value */
export function replaceRange(el: TextTarget, start: number, end: number, text: string) {
  if (el.replaceText) return el.replaceText(start, end, text)
  el.focus()
  el.setSelectionRange(start, end)
  if (!document.execCommand('insertText', false, text)) {
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** Wrap the selection in markers (**, _, `), or unwrap it if it's already wrapped */
export function toggleWrap(el: TextTarget, marker: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e)
  const n = marker.length
  if (value.slice(s - n, s) === marker && value.slice(e, e + n) === marker) {
    replaceRange(el, s - n, e + n, selected)
    el.setSelectionRange(s - n, e - n)
    return
  }
  if (selected.length > 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    replaceRange(el, s, e, selected.slice(n, -n))
    el.setSelectionRange(s, e - 2 * n)
    return
  }
  // Keep surrounding spaces outside the markers: "**word** " not "**word **"
  const lead = selected.match(/^\s*/)![0]
  const trail = selected.match(/\s*$/)![0]
  const inner = selected.trim() || placeholder
  replaceRange(el, s, e, `${lead}${marker}${inner}${marker}${trail}`)
  const at = s + lead.length + n
  el.setSelectionRange(at, at + inner.length)
}

/**
 * Fence the selected lines in a ``` code block (on their own lines), or take the fences off when the
 * selection is already one. With nothing selected it opens an empty block with the caret inside.
 */
export function toggleCodeBlock(el: TextTarget) {
  const { value } = el
  // Whole lines: from the start of the first to the end of the last
  const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1
  let e = value.indexOf('\n', el.selectionEnd - (el.selectionEnd > el.selectionStart && value[el.selectionEnd - 1] === '\n' ? 1 : 0))
  if (e < 0) e = value.length
  const block = value.slice(s, e)
  // The selection is the block's contents: the lines around it are the fences
  const before = value.slice(0, Math.max(0, s - 1))
  const open = before.lastIndexOf('\n') + 1
  if (s > 0 && /^```[^\n]*$/.test(before.slice(open)) && value.slice(e, e + 4).match(/^\n```$|^\n```\n/)) {
    replaceRange(el, open, e + 4, block)
    el.setSelectionRange(open, open + block.length)
    return
  }
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(block)
  if (fenced) {
    replaceRange(el, s, e, fenced[1]!)
    el.setSelectionRange(s, s + fenced[1]!.length)
    return
  }
  replaceRange(el, s, e, `\`\`\`\n${block}\n\`\`\``)
  el.setSelectionRange(s + 4, s + 4 + block.length)
}

/** Inside an open ``` block at the caret (an odd number of fences before it) */
export function inCodeBlock(el: TextTarget): boolean {
  return ((el.value.slice(0, el.selectionStart).match(/```/g) ?? []).length & 1) === 1
}

/** [selection](url) with "url" selected, ready to paste over */
export function insertLink(el: TextTarget) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const label = value.slice(s, e).trim() || 'link text'
  replaceRange(el, s, e, `[${label}](url)`)
  const at = s + label.length + 3
  el.setSelectionRange(at, at + 3)
}

/** Toggle a prefix on every line the selection touches: "- ", "1. ", "> " */
export function toggleLinePrefix(el: TextTarget, kind: 'bullet' | 'number' | 'quote') {
  const { selectionStart: s, selectionEnd: e, value } = el
  const start = value.lastIndexOf('\n', s - 1) + 1
  const endNl = value.indexOf('\n', e === s ? e : e - 1)
  const end = endNl === -1 ? value.length : endNl
  const lines = value.slice(start, end).split('\n')
  const has = { bullet: /^- /, number: /^\d+\. /, quote: /^> ?/ }[kind]
  const all = lines.every((l) => has.test(l) || !l.trim())
  const out = lines.map((l, i) => {
    if (!l.trim()) return l
    if (all) return l.replace(has, '')
    const bare = l.replace(/^(- |\d+\. |> ?)/, '')
    return kind === 'bullet' ? `- ${bare}` : kind === 'number' ? `${i + 1}. ${bare}` : `> ${bare}`
  })
  const text = out.join('\n')
  replaceRange(el, start, end, text)
  el.setSelectionRange(start, start + text.length)
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export interface FormatAction {
  label: string
  icon: Component
  keys: string
  /** Matches the shortcut (with Cmd/Ctrl held) */
  match: (e: KeyboardEvent) => boolean
  run: (el: TextTarget) => void
}

/** The formatting toolbar's actions and shortcuts (GitHub's keys); `strike` adds ~~strikethrough~~ */
export function formatActions(opts: { strike?: boolean } = {}): FormatAction[] {
  const key = (k: string) => (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === k
  return [
    { label: 'Bold', icon: PhTextB, keys: `${MOD}B`, match: key('b'), run: (t) => toggleWrap(t, '**', 'bold text') },
    { label: 'Italic', icon: PhTextItalic, keys: `${MOD}I`, match: key('i'), run: (t) => toggleWrap(t, '_', 'italic text') },
    ...(opts.strike
      ? [{ label: 'Strikethrough', icon: PhTextStrikethrough, keys: `${MOD}⇧X`, match: (e: KeyboardEvent) => e.shiftKey && e.key.toLowerCase() === 'x', run: (t: TextTarget) => toggleWrap(t, '~~', 'text') }]
      : []),
    // A selection over several lines becomes a block
    { label: 'Code', icon: PhCode, keys: `${MOD}E`, match: key('e'), run: (t) => (t.value.slice(t.selectionStart, t.selectionEnd).includes('\n') ? toggleCodeBlock(t) : toggleWrap(t, '`', 'code')) },
    { label: 'Code block', icon: PhCodeBlock, keys: `${MOD}⇧E`, match: (e) => e.shiftKey && e.key.toLowerCase() === 'e', run: toggleCodeBlock },
    { label: 'Link', icon: PhLinkSimple, keys: `${MOD}K`, match: key('k'), run: insertLink },
    { label: 'Bullet list', icon: PhListBullets, keys: `${MOD}⇧8`, match: (e) => e.shiftKey && e.code === 'Digit8', run: (t) => toggleLinePrefix(t, 'bullet') },
    { label: 'Numbered list', icon: PhListNumbers, keys: `${MOD}⇧7`, match: (e) => e.shiftKey && e.code === 'Digit7', run: (t) => toggleLinePrefix(t, 'number') },
    { label: 'Quote', icon: PhQuotes, keys: `${MOD}⇧.`, match: (e) => e.shiftKey && e.code === 'Period', run: (t) => toggleLinePrefix(t, 'quote') },
  ]
}

/** Runs the action whose shortcut this is; true when one ran */
export function runFormatShortcut(actions: FormatAction[], e: KeyboardEvent, target?: TextTarget): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false
  const a = actions.find((x) => x.match(e))
  if (!a) return false
  e.preventDefault()
  a.run(target ?? (e.target as unknown as TextTarget))
  return true
}

const URL_ONLY = /^(https?:\/\/|mailto:)\S+$/i
/** Pasting a URL over selected text makes it a link: [selection](url). True when it did */
export function pasteLink(e: ClipboardEvent, target?: TextTarget): boolean {
  const el = target ?? (e.target as unknown as TextTarget)
  const url = e.clipboardData?.getData('text/plain').trim() ?? ''
  const selected = el.value.slice(el.selectionStart, el.selectionEnd)
  if (!selected.trim() || !URL_ONLY.test(url) || URL_ONLY.test(selected.trim()) || selected.includes('\n')) return false
  e.preventDefault()
  replaceRange(el, el.selectionStart, el.selectionEnd, `[${selected}](${url})`)
  return true
}

/** Insert text at the cursor (replacing the selection) */
export function insertAtCursor(el: TextTarget, text: string) {
  replaceRange(el, el.selectionStart, el.selectionEnd, text)
}
