import type { Component } from 'vue'
import { PhCode, PhLinkSimple, PhListBullets, PhListNumbers, PhQuotes, PhTextB, PhTextItalic, PhTextStrikethrough } from '@phosphor-icons/vue'

/**
 * Markdown formatting on a textarea selection. Edits go through insertText so the browser's undo
 * history works (one Cmd+Z per action) and `input` fires for v-model. Applying a format to text
 * that already has it removes it.
 */

/** Replace a range, keeping undo history; falls back to setting the value */
function replace(el: HTMLTextAreaElement, start: number, end: number, text: string) {
  el.focus()
  el.setSelectionRange(start, end)
  if (!document.execCommand('insertText', false, text)) {
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** Wrap the selection in markers (**, _, `), or unwrap it if it's already wrapped */
export function toggleWrap(el: HTMLTextAreaElement, marker: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e)
  const n = marker.length
  if (value.slice(s - n, s) === marker && value.slice(e, e + n) === marker) {
    replace(el, s - n, e + n, selected)
    el.setSelectionRange(s - n, e - n)
    return
  }
  if (selected.length > 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    replace(el, s, e, selected.slice(n, -n))
    el.setSelectionRange(s, e - 2 * n)
    return
  }
  // Keep surrounding spaces outside the markers: "**word** " not "**word **"
  const lead = selected.match(/^\s*/)![0]
  const trail = selected.match(/\s*$/)![0]
  const inner = selected.trim() || placeholder
  replace(el, s, e, `${lead}${marker}${inner}${marker}${trail}`)
  const at = s + lead.length + n
  el.setSelectionRange(at, at + inner.length)
}

/** [selection](url) with "url" selected, ready to paste over */
export function insertLink(el: HTMLTextAreaElement) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const label = value.slice(s, e).trim() || 'link text'
  replace(el, s, e, `[${label}](url)`)
  const at = s + label.length + 3
  el.setSelectionRange(at, at + 3)
}

/** Toggle a prefix on every line the selection touches: "- ", "1. ", "> " */
export function toggleLinePrefix(el: HTMLTextAreaElement, kind: 'bullet' | 'number' | 'quote') {
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
  replace(el, start, end, text)
  el.setSelectionRange(start, start + text.length)
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export interface FormatAction {
  label: string
  icon: Component
  keys: string
  /** Matches the shortcut (with Cmd/Ctrl held) */
  match: (e: KeyboardEvent) => boolean
  run: (el: HTMLTextAreaElement) => void
}

/** The formatting toolbar's actions and shortcuts (GitHub's keys); `strike` adds ~~strikethrough~~ */
export function formatActions(opts: { strike?: boolean } = {}): FormatAction[] {
  const key = (k: string) => (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === k
  return [
    { label: 'Bold', icon: PhTextB, keys: `${MOD}B`, match: key('b'), run: (t) => toggleWrap(t, '**', 'bold text') },
    { label: 'Italic', icon: PhTextItalic, keys: `${MOD}I`, match: key('i'), run: (t) => toggleWrap(t, '_', 'italic text') },
    ...(opts.strike
      ? [{ label: 'Strikethrough', icon: PhTextStrikethrough, keys: `${MOD}⇧X`, match: (e: KeyboardEvent) => e.shiftKey && e.key.toLowerCase() === 'x', run: (t: HTMLTextAreaElement) => toggleWrap(t, '~~', 'text') }]
      : []),
    { label: 'Code', icon: PhCode, keys: `${MOD}E`, match: key('e'), run: (t) => toggleWrap(t, '`', 'code') },
    { label: 'Link', icon: PhLinkSimple, keys: `${MOD}K`, match: key('k'), run: insertLink },
    { label: 'Bullet list', icon: PhListBullets, keys: `${MOD}⇧8`, match: (e) => e.shiftKey && e.code === 'Digit8', run: (t) => toggleLinePrefix(t, 'bullet') },
    { label: 'Numbered list', icon: PhListNumbers, keys: `${MOD}⇧7`, match: (e) => e.shiftKey && e.code === 'Digit7', run: (t) => toggleLinePrefix(t, 'number') },
    { label: 'Quote', icon: PhQuotes, keys: `${MOD}⇧.`, match: (e) => e.shiftKey && e.code === 'Period', run: (t) => toggleLinePrefix(t, 'quote') },
  ]
}

/** Runs the action whose shortcut this is; true when one ran */
export function runFormatShortcut(actions: FormatAction[], e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false
  const a = actions.find((x) => x.match(e))
  if (!a) return false
  e.preventDefault()
  a.run(e.target as HTMLTextAreaElement)
  return true
}

const URL_ONLY = /^(https?:\/\/|mailto:)\S+$/i
/** Pasting a URL over selected text makes it a link: [selection](url). True when it did */
export function pasteLink(e: ClipboardEvent): boolean {
  const el = e.target as HTMLTextAreaElement
  const url = e.clipboardData?.getData('text/plain').trim() ?? ''
  const selected = el.value.slice(el.selectionStart, el.selectionEnd)
  if (!selected.trim() || !URL_ONLY.test(url) || URL_ONLY.test(selected.trim()) || selected.includes('\n')) return false
  e.preventDefault()
  replace(el, el.selectionStart, el.selectionEnd, `[${selected}](${url})`)
  return true
}

/** Insert text at the cursor (replacing the selection) */
export function insertAtCursor(el: HTMLTextAreaElement, text: string) {
  replace(el, el.selectionStart, el.selectionEnd, text)
}
