import { shallowRef } from 'vue'
import UNICODE from '@shared/slackEmoji.json'
import { api } from '@/api'

/**
 * Slack :shortcode: emoji: the standard set (shared/slackEmoji.json, from Slack's own emoji-data, in
 * Slack's order; regenerate with scripts/gen-emoji.mjs) and the workspace's custom ones
 * (`GET /api/slack/emoji`, asked once per page load, needs emoji:read). `emoji(name)` is a character,
 * an image URL, or null for an unknown name; `searchEmoji` feeds the picker and the `:name` autocomplete.
 */
const custom = shallowRef<Record<string, string>>({})
let asked = false

export type Emoji = { char: string } | { url: string } | null

/** One pickable emoji: a standard one (`char`, its other names in `aliases`) or a custom one (`url`) */
export interface EmojiItem {
  name: string
  char?: string
  url?: string
  aliases?: string[]
}

const MAP = UNICODE as Record<string, string>
/** Standard emoji once each (first name wins), in Slack's order */
const STANDARD: EmojiItem[] = (() => {
  const byChar = new Map<string, EmojiItem>()
  for (const [name, char] of Object.entries(MAP)) {
    if (name.startsWith('skin-tone')) continue
    const e = byChar.get(char)
    if (e) e.aliases!.push(name)
    else byChar.set(char, { name, char, aliases: [] })
  }
  return [...byChar.values()]
})()

function load() {
  if (asked) return
  asked = true
  api
    .slackEmoji()
    .then((r) => (custom.value = r.emoji))
    .catch(() => (asked = false))
}

/** The workspace's own emoji (aliases of standard ones left out: those are in the standard set) */
function customItems(): EmojiItem[] {
  return Object.entries(custom.value)
    .filter(([, v]) => !v.startsWith('unicode:'))
    .map(([name, url]) => ({ name, url }))
}

/**
 * Emoji for a query: names (and aliases) starting with it first, then containing it, each in Slack's
 * order; custom ones after standard ones at the same rank. Empty query: everything.
 */
export function searchEmoji(query: string, limit = Infinity): EmojiItem[] {
  load()
  const q = query.toLowerCase().replace(/^:|:$/g, '')
  const all = [...STANDARD, ...customItems()]
  if (!q) return all.slice(0, limit)
  const ranked: [number, EmojiItem][] = []
  for (const e of all) {
    const names = [e.name, ...(e.aliases ?? [])]
    const starts = names.find((n) => n.startsWith(q))
    const has = starts ?? names.find((n) => n.includes(q))
    // The name shown is the one that matched (:thumbsup: for "thu", not :+1:)
    if (has) ranked.push([starts ? (starts === q ? 0 : 1) : 2, { ...e, name: has }])
  }
  return ranked
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, e]) => e)
}

/** What goes into the text for a picked emoji: the character, or :name: for a custom one */
export const emojiText = (e: EmojiItem) => e.char ?? `:${e.name}:`

export function useSlackEmoji() {
  load()
  function emoji(name: string): Emoji {
    const n = name.toLowerCase()
    const c = custom.value[n]
    if (c) return c.startsWith('unicode:') ? emoji(c.slice(8)) : { url: c }
    const u = MAP[n]
    return u ? { char: u } : null
  }
  return { emoji, custom }
}
