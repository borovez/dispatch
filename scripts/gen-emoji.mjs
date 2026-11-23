// Writes shared/slackEmoji.json: Slack's :shortcode: names (iamcal/emoji-data, the set Slack uses) → emoji.
// Run after bumping emoji-datasource: node scripts/gen-emoji.mjs
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const data = createRequire(import.meta.url)('emoji-datasource/emoji.json')
const char = (unified) => String.fromCodePoint(...unified.split('-').map((h) => parseInt(h, 16)))
const out = {}
for (const e of data.sort((a, b) => a.sort_order - b.sort_order)) for (const n of e.short_names) out[n] ??= char(e.unified)
writeFileSync(new URL('../shared/slackEmoji.json', import.meta.url), JSON.stringify(out))
console.log(Object.keys(out).length, 'names')
