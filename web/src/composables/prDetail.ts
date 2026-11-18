import type { PrDetail, PrView } from '@shared/types'
import { api } from '@/api'

/** PR description and files, fetched once per PR version (updatedAt) and shared by the panel and previews */
const cache = new Map<string, Promise<PrDetail>>()

export function loadPrDetail(pr: Pick<PrView, 'id' | 'updatedAt'>): Promise<PrDetail> {
  const key = `${pr.id}|${pr.updatedAt}`
  let p = cache.get(key)
  if (!p) {
    p = api.prDetail(pr.id)
    cache.set(key, p)
    p.catch(() => cache.delete(key)) // retry next time
  }
  return p
}

/** Plain-text start of GitHub's rendered description, for previews */
/** Section headings that are bookkeeping, not what the PR does (Dispatch shows those elsewhere) */
const BOOKKEEPING =
  /^(jira|tickets?|issues?|stack|dependencies|deploy(ment)?( (steps|plan|notes))?|steps|env(ironment)? variables|migrations?|checklist|self[- ]review|security|feature flags?|screenshots?|testing( instructions)?|how to test|test plan|qa|notes|related|links)\b/i
/** Headings whose section says what the PR does: preferred when there is one */
const ABOUT = /^(summary|description|what( and why)?|why|overview|context|changes|what changed|problem|solution|motivation)\b/i
/** Lines that only declare dependencies or flags */
const DECLARATION = /^(depends on|requires release of|blocks|release blocks|feature flags?|no jira issue)\s*:/i

/**
 * What the PR does, for a hover card: a Summary / Description / What-and-why section when there is
 * one, else the text before the first heading, else the first section that isn't bookkeeping (JIRA,
 * stack, deployment, testing…); declaration lines left out, shortened.
 */
export function descriptionSummary(html: string, max = 220): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  // Sections: the text before any heading, then one per heading
  const sections: { heading: string; text: string[] }[] = [{ heading: '', text: [] }]
  for (const el of Array.from(body.children)) {
    if (/^H[1-6]$/.test(el.tagName)) {
      sections.push({ heading: el.textContent?.trim() ?? '', text: [] })
      continue
    }
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text && !DECLARATION.test(text)) sections.at(-1)!.text.push(text)
  }
  const pick =
    sections.find((x) => ABOUT.test(x.heading) && x.text.length) ??
    (sections[0]!.text.length ? sections[0] : undefined) ??
    sections.find((x) => x.heading && !BOOKKEEPING.test(x.heading) && x.text.length)
  const text = pick?.text.join(' ') ?? ''
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

