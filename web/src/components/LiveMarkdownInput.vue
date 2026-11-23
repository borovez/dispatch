<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type HTMLAttributes } from 'vue'
import { highlightMarkdown } from '@/lib/markdownHighlight'
import type { TextTarget } from '@/composables/markdownFormat'
import { cn } from '@/lib/utils'

/**
 * A Markdown input that styles as you type (Slack-like): a contenteditable whose text is the Markdown
 * itself, re-rendered from `highlightMarkdown` on every change with the caret put back by offset. Code is
 * monospaced, a ``` block is one rounded box, @mentions are tinted. Formatting marks are dimmed, or with
 * `marks` off hidden: inline ones show on the caret's line, a closed ``` block's fences never (Backspace at
 * the start of its code unwraps it), an unclosed block's while it is typed.
 *
 * Re-rendering wipes the browser's undo history, so it keeps its own (Cmd/Ctrl+Z, Shift+Cmd+Z, Ctrl+Y,
 * Edit menu). Enter inserts a new line unless a keydown listener took it (Enter to send): it continues a
 * list, and on an opening ``` line it adds the closing fence with the caret between. Paste is plain text
 * (a URL over a selection makes a link). `target` acts like a textarea for the toolbar helpers
 * (markdownFormat.ts), plus `coordsAt(offset)` for menus at the caret.
 */
const props = defineProps<{
  placeholder?: string
  disabled?: boolean
  mentions?: string[]
  /** Show formatting marks everywhere (default); false hides them off the caret's line */
  marks?: boolean
  class?: HTMLAttributes['class']
}>()
const emit = defineEmits<{ keydown: [e: KeyboardEvent]; blur: [] }>()
const model = defineModel<string>({ required: true })

const root = ref<HTMLDivElement | null>(null)
type Sel = { start: number; end: number }
/**
 * The text as the editor has it. The model only catches up when the parent re-renders, so everything
 * here reads this, and the model is just told.
 */
let current = ''
/** Set the text (and tell the model) */
function setText(v: string) {
  current = v
  model.value = v
}
/** The selection last seen inside the editor (kept while focus is in a menu) */
let lastSel: Sel = { start: 0, end: 0 }
let composing = false
/** Focus is in the editor (asked of the document: focus events don't always come, e.g. a background window) */
const isFocused = () => !!root.value && document.activeElement === root.value

// ---------- text and offsets ----------

/** Text of a node or fragment: text nodes, and <br> as a new line (except the trailing one we add) */
/** The zero-width span that holds the caret in a ``` block with nothing visible in it */
const isAnchor = (n: Node) => n.parentElement?.dataset.caretAnchor !== undefined

function textOf(node: Node): string {
  let out = ''
  const walk = (n: Node) => {
    // A caret anchor's zero-width space isn't text (anything typed into it is)
    if (n.nodeType === Node.TEXT_NODE) out += isAnchor(n) ? (n as Text).data.replace(/\u200b/g, '') : (n as Text).data
    else if (n.nodeName === 'BR') out += (n as HTMLElement).dataset.tail ? '' : '\n'
    else n.childNodes.forEach(walk)
  }
  walk(node)
  return out
}

function offsetOf(container: Node, offset: number): number {
  const r = document.createRange()
  r.setStart(root.value!, 0)
  r.setEnd(container, offset)
  return textOf(r.cloneContents()).length
}

/** The selection as offsets, when it is inside the editor */
function readSel(): Sel | null {
  const s = window.getSelection()
  // Unfocused, the DOM selection isn't the caret any more (a re-render on blur collapses it to the start)
  if (!s?.rangeCount || !isFocused() || !root.value?.contains(s.anchorNode)) return null
  const r = s.getRangeAt(0)
  return { start: offsetOf(r.startContainer, r.startOffset), end: offsetOf(r.endContainer, r.endOffset) }
}
const sel = (): Sel => readSel() ?? lastSel

/** DOM position of a text offset. After a new line it prefers the start of the next node (the next line) */
function locate(offset: number): [Node, number] {
  const el = root.value!
  const text = current
  const tail = el.lastChild as HTMLElement | null
  if (offset >= text.length && text.endsWith('\n') && tail?.nodeName === 'BR') return [el, el.childNodes.length - 1]
  const afterNewline = offset > 0 && text[offset - 1] === '\n'
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let at = 0
  let last: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    // Hidden marks can't hold the caret
    if (n.parentElement?.classList.contains('hidden')) {
      at += n.data.length
      continue
    }
    if (isAnchor(n)) {
      if (offset === at) return [n, 0]
      continue
    }
    const end = at + n.data.length
    if (afterNewline ? offset < end || (offset === end && offset === text.length) : offset <= end) return [n, Math.max(0, offset - at)]
    at = end
    last = n
  }
  return last ? [last, last.data.length] : [el, 0]
}

function setSel(start: number, end = start) {
  const el = root.value
  if (!el) return
  lastSel = { start, end }
  if (!isFocused()) return
  const s = window.getSelection()
  if (!s) return
  const r = document.createRange()
  const [a, ao] = locate(start)
  r.setStart(a, ao)
  if (end === start) r.collapse(true)
  else {
    const [b, bo] = locate(end)
    r.setEnd(b, bo)
  }
  s.removeAllRanges()
  s.addRange(r)
}

// ---------- rendering ----------

/** What shows its marks while they're hidden: the caret's line and the ``` block it's in */
function revealKey(): string {
  if (props.marks !== false || !isFocused()) return ''
  const { start } = lastSel
  const text = current
  const ls = text.lastIndexOf('\n', start - 1) + 1
  return `${ls}`
}

let shownReveal = ''
function render() {
  const el = root.value
  if (!el) return
  const text = current
  const runs = highlightMarkdown(text, props.mentions)
  const hide = props.marks === false
  const caret = lastSel.start
  const ls = text.lastIndexOf('\n', caret - 1) + 1
  const nl = text.indexOf('\n', caret)
  const le = nl < 0 ? text.length : nl
  const frag = document.createDocumentFragment()
  let box: HTMLElement | null = null
  let boxId = -1
  let at = 0
  for (const r of runs) {
    if (r.block !== boxId) {
      box = null
      boxId = r.block
      if (r.block >= 0) {
        box = document.createElement('span')
        box.className = 'my-1 block min-h-[calc(1.625em+1rem+2px)] rounded-md border bg-muted px-3 py-2 font-mono text-[0.85em] leading-relaxed'
        box.dataset.codeBlock = ''
        frag.appendChild(box)
      }
    }
    const span = document.createElement('span')
    // Hidden marks: a closed ``` block never shows its fences (the box says it's code); an unclosed one
    // does (it's being typed); inline marks show on the caret's line
    const visible = !hide || !r.mark || (r.block >= 0 ? !!r.open : isFocused() && at <= le && at + r.text.length >= ls)
    span.className = cn(r.class, !visible && 'hidden')
    span.textContent = r.text
    // Before a hidden closing fence, when the code is empty or ends with a new line: that last line has
    // nothing in it to show it or hold the caret, so a zero-width anchor does
    const prev = box?.lastElementChild
    if (box && !visible && r.text.startsWith('\n') && (prev?.classList.contains('hidden') || prev?.textContent?.endsWith('\n'))) {
      const anchor = document.createElement('span')
      anchor.dataset.caretAnchor = ''
      anchor.textContent = '\u200b'
      box.appendChild(anchor)
    }
    ;(box ?? frag).appendChild(span)
    at += r.text.length
  }
  // A trailing new line needs something after it to show its line
  if (text.endsWith('\n')) {
    const br = document.createElement('br')
    br.dataset.tail = '1'
    frag.appendChild(br)
  }
  el.replaceChildren(frag)
  shownReveal = revealKey()
}

/** Re-render keeping the caret */
function refresh() {
  const s = readSel() ?? lastSel
  lastSel = s
  render()
  setSel(s.start, s.end)
}

// ---------- history ----------

type Entry = Sel & { text: string }
let history: Entry[] = []
let index = -1
let lastKind = ''
let lastAt = 0
function record(text: string, s: Sel, kind: string) {
  const now = Date.now()
  // Typing (or deleting) in a run is one undo step
  const merge = (kind === 'insertText' || kind === 'deleteContentBackward') && kind === lastKind && now - lastAt < 1000 && index === history.length - 1
  history = history.slice(0, index + 1)
  if (merge && history.length > 1) history[history.length - 1] = { text, ...s }
  else history.push({ text, ...s })
  if (history.length > 200) history.shift()
  index = history.length - 1
  lastKind = kind
  lastAt = now
}
function travel(step: 1 | -1) {
  const to = index + step
  if (to < 0 || to >= history.length) return
  index = to
  lastKind = ''
  const e = history[to]!
  setText(e.text)
  lastSel = { start: e.start, end: e.end }
  render()
  setSel(e.start, e.end)
}

// ---------- edits ----------

function commit(text: string, s: Sel, kind: string) {
  lastSel = s
  if (text !== current) {
    setText(text)
    record(text, s, kind)
  }
  render()
  setSel(s.start, s.end)
}

function replaceText(start: number, end: number, text: string) {
  focus()
  const v = current
  const at = start + text.length
  commit(v.slice(0, start) + text + v.slice(end), { start: at, end: at }, 'replace')
}

/** Enter: a new line, continuing a list, or closing a ``` block that was just opened */
function newline() {
  const { start, end } = sel()
  const text = current
  const ls = text.lastIndexOf('\n', start - 1) + 1
  const line = text.slice(ls, start)
  const restOfLine = text.slice(end, text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end))
  const fences = (s: string) => (s.match(/(^|\n)```/g) ?? []).length
  // ``` (with a language or not) at the end of its line, opening a block nothing closes yet
  if (start === end && /^```[\w+#.-]*$/.test(line) && !restOfLine.trim() && fences(text.slice(0, ls)) % 2 === 0 && fences(text.slice(end)) % 2 === 0) {
    const v = text.slice(0, start) + '\n\n```' + text.slice(end)
    return commit(v, { start: start + 1, end: start + 1 }, 'replace')
  }
  const inBlock = fences(text.slice(0, ls)) % 2 === 1
  const item = !inBlock && start === end ? /^(\s*)([-*+]|(\d+)([.)]))\s+(.*)$/.exec(line) : null
  if (item) {
    // An empty item ends the list
    if (!item[5]!.trim()) return commit(text.slice(0, ls) + text.slice(start), { start: ls, end: ls }, 'replace')
    const marker = item[3] ? `${Number(item[3]) + 1}${item[4]}` : item[2]
    return replaceText(start, end, `\n${item[1]}${marker} `)
  }
  replaceText(start, end, '\n')
}

/**
 * ArrowDown on a ``` block's last line when nothing follows the block: a new line after it (like Slack),
 * instead of landing on the closing fence with no way out
 */
function exitBlock(): boolean {
  const { start, end } = sel()
  if (start !== end) return false
  const close = current.indexOf('\n```', start)
  if (close < 0 || current.indexOf('\n', start) !== close) return false
  if (((current.slice(0, start).match(/(^|\n)```/g) ?? []).length & 1) !== 1) return false
  if (!/^```[^\S\n]*$/.test(current.slice(close + 1))) return false
  const v = current + '\n'
  commit(v, { start: v.length, end: v.length }, 'replace')
  return true
}

/**
 * Backspace at the very start of a closed ``` block's code: the fences go, the code stays as text (with
 * hidden fences there is no other way to take a block apart)
 */
function unwrapBlock(): boolean {
  const { start, end } = sel()
  if (start !== end) return false
  for (const m of current.matchAll(/(^|\n)(```[^\n]*\n)([\s\S]*?)(\n```[^\S\n]*)(?=\n|$)/g)) {
    const open = m.index + m[1]!.length
    const body = open + m[2]!.length
    if (body > start) break
    if (body !== start) continue
    const closeEnd = body + m[3]!.length + m[4]!.length
    commit(current.slice(0, open) + m[3] + current.slice(closeEnd), { start: open, end: open }, 'replace')
    return true
  }
  return false
}

function onBeforeInput(e: InputEvent) {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault()
    travel(e.inputType === 'historyUndo' ? -1 : 1)
  } else if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
    e.preventDefault()
    newline()
  }
}

function onInput(e: Event) {
  if (composing) return
  const s = readSel() ?? lastSel
  const kind = (e as InputEvent).inputType ?? ''
  const text = textOf(root.value!)
  // ``` typed at the start of a line, nothing after it and no block left open above: a block, closed,
  // with the caret on its empty line (like Slack)
  if (kind === 'insertText' && (e as InputEvent).data === '`' && s.start === s.end) {
    const ls = text.lastIndexOf('\n', s.start - 1) + 1
    const nl = text.indexOf('\n', s.start)
    const fences = (t: string) => (t.match(/(^|\n)```/g) ?? []).length
    if (text.slice(ls, s.start) === '```' && !text.slice(s.start, nl < 0 ? text.length : nl).trim() && fences(text.slice(0, ls)) % 2 === 0) {
      // The plain ``` first, so one undo takes the block back to what was typed
      commit(text, s, kind)
      const v = text.slice(0, s.start) + '\n\n```' + text.slice(s.start)
      return commit(v, { start: s.start + 1, end: s.start + 1 }, 'replace')
    }
  }
  commit(text, s, kind)
}

function onCompositionStart() {
  composing = true
}
function onCompositionEnd(e: CompositionEvent) {
  composing = false
  onInput(e)
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || (e.ctrlKey && e.key.toLowerCase() === 'y'))) {
    e.preventDefault()
    travel(e.key.toLowerCase() === 'y' || e.shiftKey ? 1 : -1)
    return
  }
  if (e.key === 'Backspace' && !mod && !e.altKey && unwrapBlock()) {
    e.preventDefault()
    return
  }
  if (e.key === 'ArrowDown' && !mod && !e.shiftKey && !e.altKey && exitBlock()) {
    e.preventDefault()
    return
  }
  emit('keydown', e)
  if (!e.defaultPrevented && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    newline()
  }
}

const URL_ONLY = /^(https?:\/\/|mailto:)\S+$/i
function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const data = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
  if (!data) return
  const { start, end } = sel()
  const selected = current.slice(start, end)
  const url = data.trim()
  if (selected.trim() && !selected.includes('\n') && URL_ONLY.test(url) && !URL_ONLY.test(selected.trim())) replaceText(start, end, `[${selected}](${url})`)
  else replaceText(start, end, data)
}

// Marks follow the caret (keys, clicks); never re-rendered mid-drag
function onCaretMoved() {
  const s = readSel()
  if (s) lastSel = s
  if (revealKey() !== shownReveal) refresh()
}
function onSelectionChange() {
  // Only while editing: a re-render after blur collapses the DOM selection, and that must not become
  // where an insert from a menu (@ mention) lands
  if (!isFocused()) return
  const s = readSel()
  if (s) lastSel = s
}

function onFocus() {
  onCaretMoved()
}
function onBlur() {
  // lastSel stays what it was while editing: by now the browser may have moved the DOM selection
  if (props.marks === false) render()
  emit('blur')
}

function focus() {
  const el = root.value
  if (!el) return
  if (document.activeElement !== el) {
    el.focus({ preventScroll: true })
    setSel(lastSel.start, lastSel.end)
  }
}

// Changes from outside (draft cleared after sending, restored), mentions, the marks toggle
watch(model, (v) => {
  if (v === current) return
  current = v
  const at = Math.min(lastSel.start, v.length)
  lastSel = { start: at, end: at }
  record(v, lastSel, 'external')
  refresh()
})
watch(
  () => [props.mentions?.join('\n'), props.marks],
  () => refresh(),
)

onMounted(() => {
  current = model.value
  record(current, lastSel, 'external')
  render()
  document.addEventListener('selectionchange', onSelectionChange)
})
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

/** Acts like a textarea for the formatting helpers */
const target: TextTarget & { coordsAt(offset: number): { left: number; top: number; bottom: number } } = {
  get value() {
    return current
  },
  set value(v: string) {
    commit(v, { start: v.length, end: v.length }, 'replace')
  },
  get selectionStart() {
    return sel().start
  },
  get selectionEnd() {
    return sel().end
  },
  setSelectionRange(start: number, end: number) {
    focus()
    setSel(start, end)
  },
  focus,
  dispatchEvent: () => true,
  replaceText,
  /** Viewport position of a text offset (for a menu at the caret) */
  coordsAt(offset: number) {
    const el = root.value!
    const r = document.createRange()
    const [n, o] = locate(offset)
    r.setStart(n, o)
    r.collapse(true)
    let rect = r.getClientRects()[0] ?? r.getBoundingClientRect()
    // A collapsed range at a line start can measure as nothing: measure the next character instead
    if (!rect.height && n.nodeType === Node.TEXT_NODE && o < (n as Text).data.length) {
      r.setEnd(n, o + 1)
      rect = r.getClientRects()[0] ?? rect
    }
    if (!rect.height) {
      const box = el.getBoundingClientRect()
      return { left: box.left + 10, top: box.top + 8, bottom: box.top + 28 }
    }
    return { left: rect.left, top: rect.top, bottom: rect.bottom }
  },
}
defineExpose({ target, focus })
</script>

<template>
  <div
    ref="root"
    role="textbox"
    aria-multiline="true"
    :aria-placeholder="placeholder"
    :aria-disabled="disabled || undefined"
    :data-placeholder="placeholder"
    :contenteditable="disabled ? 'false' : 'plaintext-only'"
    spellcheck="true"
    :class="
      cn(
        'overflow-y-auto px-2.5 py-2 text-sm break-words whitespace-pre-wrap outline-none',
        'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
        disabled && 'cursor-not-allowed',
        props.class,
      )
    "
    @beforeinput="onBeforeInput"
    @input="onInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
    @keydown="onKeydown"
    @keyup="onCaretMoved"
    @mouseup="onCaretMoved"
    @paste="onPaste"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>
