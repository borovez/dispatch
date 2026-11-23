import { shallowRef } from 'vue'
import UNICODE from '@shared/slackEmoji.json'
import { api } from '@/api'

/**
 * Slack :shortcode: emoji: the standard set (shared/slackEmoji.json, from Slack's own emoji-data; regenerate
 * with scripts/gen-emoji.mjs) and the workspace's custom ones (`GET /api/slack/emoji`, asked once per
 * page load, needs emoji:read). `emoji(name)` is a character, an image URL, or null for an unknown name.
 */
const custom = shallowRef<Record<string, string>>({})
let asked = false

export type Emoji = { char: string } | { url: string } | null

export function useSlackEmoji() {
  if (!asked) {
    asked = true
    api
      .slackEmoji()
      .then((r) => (custom.value = r.emoji))
      .catch(() => (asked = false))
  }
  function emoji(name: string): Emoji {
    const n = name.toLowerCase()
    const c = custom.value[n]
    if (c) return c.startsWith('unicode:') ? emoji(c.slice(8)) : { url: c }
    const u = (UNICODE as Record<string, string>)[n]
    return u ? { char: u } : null
  }
  return { emoji, custom }
}
