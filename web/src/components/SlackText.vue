<script setup lang="ts">
import { h, type VNode } from 'vue'
import { useDeck } from '@/stores/deck'
import { useSlackEmoji } from '@/composables/slackEmoji'
import RepoName from './RepoName.vue'

/**
 * Renders Slack mrkdwn (links, mentions, *bold*, _italic_, ~strike~, `code`, ``` blocks, > quotes)
 * as Vue elements, never as HTML strings. Without `rich` (older items) it shows the plain text.
 */
const props = defineProps<{ text: string; rich?: string | null }>()

const deck = useDeck()
const { emoji, custom } = useSlackEmoji()

/** Plain text with :shortcode: emoji as characters or the workspace's images (unknown names stay as typed) */
function withEmoji(s: string): (VNode | string)[] {
  void custom.value // re-render once the custom emoji arrive
  const out: (VNode | string)[] = []
  let last = 0
  for (const m of s.matchAll(/:([a-z0-9_+'-]+):/gi)) {
    const e = emoji(m[1]!)
    if (!e) continue
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(
      'char' in e
        ? h('span', { title: m[0] }, e.char)
        : h('img', { src: e.url, alt: m[0], title: m[0], loading: 'lazy', class: 'inline-block size-[1.3em] object-contain align-[-0.3em]' }),
    )
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
/** https://github.com/owner/repo/pull/123 (with anything after: /files, #discussion…) */
const GITHUB_PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i

/** A PR link as a chip: opens the PR panel when Dispatch has the PR, GitHub otherwise */
function prChip(url: string, owner: string, repo: string, n: string): VNode {
  const shown = `${owner}/${repo}#${n}`
  const pr = deck.byId.get(shown.toLowerCase()) ?? deck.byId.get(shown)
  return h(
    'a',
    {
      href: url,
      target: '_blank',
      rel: 'noopener',
      title: pr ? `${pr.title} (open in Dispatch)` : `${shown} (open on GitHub)`,
      // The link card's hint follows what a click does
      ...(pr ? { 'data-opens-in-app': '' } : {}),
      class: 'inline-flex max-w-full items-baseline rounded bg-primary/12 px-1 align-baseline font-mono text-[0.85em] text-primary hover:bg-primary/20',
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        if (pr && !e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          deck.selectedId = pr.id
        }
      },
    },
    [h(RepoName, { id: shown })],
  )
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const SAFE_URL = /^(https?:|mailto:)/i

/** <…> tokens: links, user/channel mentions, broadcasts */
function token(body: string): VNode | string {
  const [target, label] = body.split('|', 2) as [string, string | undefined]
  const chip = (t: string) => h('span', { class: 'rounded bg-primary/12 px-1 font-medium text-primary' }, t)
  if (target.startsWith('@')) return chip(`@${label ?? target.slice(1)}`)
  if (target.startsWith('#')) return chip(`#${label ?? target.slice(1)}`)
  if (target.startsWith('!subteam')) return chip(label ?? '@group')
  if (target.startsWith('!')) return chip(`@${target.slice(1)}`)
  if (!SAFE_URL.test(target)) return decode(label ?? target)
  const gh = GITHUB_PR.exec(target)
  if (gh) return prChip(target, gh[1], gh[2], gh[3])
  const shown = decode(label ?? target.replace(/^mailto:/, ''))
  return h('a', { href: target, target: '_blank', rel: 'noopener', class: 'text-primary underline underline-offset-2 break-all', onClick: (e: Event) => e.stopPropagation() }, shown)
}

/** Inline markup; styles nest (e.g. a link inside bold) */
const INLINE = /<([^>\n]+)>|`([^`\n]+)`|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)|(?<!\w)~([^~\n]+)~(?!\w)/g
function inline(s: string): (VNode | string)[] {
  const out: (VNode | string)[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(...withEmoji(decode(s.slice(last, m.index))))
    if (m[1] !== undefined) out.push(token(m[1]))
    else if (m[2] !== undefined) out.push(h('code', { class: 'rounded bg-muted px-1 font-mono text-[0.9em]' }, decode(m[2])))
    else if (m[3] !== undefined) out.push(h('strong', { class: 'font-semibold' }, inline(m[3])))
    else if (m[4] !== undefined) out.push(h('em', inline(m[4])))
    else if (m[5] !== undefined) out.push(h('s', inline(m[5])))
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(...withEmoji(decode(s.slice(last))))
  return out
}

/** Code blocks, then quote runs, then paragraphs (line breaks kept) */
function blocks(src: string): VNode[] {
  const out: VNode[] = []
  src.split(/```/).forEach((part, i) => {
    if (i % 2) {
      out.push(h('pre', { class: 'my-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap' }, decode(part.replace(/^\n|\n$/g, ''))))
      return
    }
    let para: string[] = []
    let quote: string[] = []
    const flush = () => {
      if (para.length) out.push(h('span', { class: 'block whitespace-pre-wrap' }, inline(para.join('\n'))))
      if (quote.length) out.push(h('blockquote', { class: 'my-1 border-l-2 border-border pl-2 text-muted-foreground whitespace-pre-wrap' }, inline(quote.join('\n'))))
      para = []
      quote = []
    }
    for (const line of part.split('\n')) {
      const q = /^(&gt;|>)\s?/.exec(line)
      if (q) {
        if (para.length) flush()
        quote.push(line.slice(q[0].length))
      } else {
        if (quote.length) flush()
        para.push(line)
      }
    }
    flush()
  })
  return out
}

const render = () =>
  props.rich ? h('div', { class: 'break-words' }, blocks(props.rich.trim())) : h('div', { class: 'break-words whitespace-pre-line' }, withEmoji(props.text))
</script>

<template>
  <render />
</template>
