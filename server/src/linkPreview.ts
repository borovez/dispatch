import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { LinkPreview } from '../../shared/types.ts'
import { getSettings } from './db.ts'
import { githubItemInfo, githubRepoInfo } from './github.ts'
import { getIssue } from './jira.ts'
import { accountForOwner } from './sync.ts'

/**
 * Link hover card details (`GET /api/link-preview?url=`). GitHub and Jira links are read through their
 * APIs with the configured credentials (a page fetch would only see a login wall); other http(s) links
 * get the page's <title> and Open Graph tags. Page fetches never reach this machine or the local
 * network (every resolved address is checked, redirects included), send no cookies, stop after
 * 512 KB and 6 s. Results are kept in memory for an hour.
 */

const TTL = 60 * 60_000
const cache = new Map<string, { at: number; value: Promise<LinkPreview> }>()

export function linkPreview(url: string): Promise<LinkPreview> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const value = build(url).catch((e): LinkPreview => ({ url, source: 'none', error: (e as Error).message }))
  cache.set(url, { at: Date.now(), value })
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return value
}

async function build(raw: string): Promise<LinkPreview> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { url: raw, source: 'none', error: 'Not a valid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url: raw, source: 'none' }
  const host = u.hostname.replace(/^www\./, '')
  const s = getSettings()

  if (host === 'github.com') {
    const accounts = s.github?.accounts ?? []
    const [owner, repo, kind, num] = u.pathname.split('/').filter(Boolean)
    if (!owner || !repo) return { url: raw, source: 'none' }
    const acc = accountForOwner(accounts, owner)
    if (!acc) return { url: raw, source: 'none', error: 'No GitHub account in Settings' }
    const full = `${owner}/${repo}`
    if ((kind === 'pull' || kind === 'issues') && /^\d+$/.test(num ?? '')) {
      const it = await githubItemInfo(acc, full, kind, Number(num))
      return { url: raw, source: 'github', siteName: 'GitHub', title: it.title, description: summary(it.body), state: it.state, author: it.author, updatedAt: it.updatedAt }
    }
    const r = await githubRepoInfo(acc, full)
    return { url: raw, source: 'github', siteName: 'GitHub', title: r.title, description: r.description, state: r.private ? 'private' : 'public', updatedAt: r.updatedAt }
  }

  if (host.endsWith('.atlassian.net')) {
    const key = u.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i)?.[1] ?? u.searchParams.get('selectedIssue')
    if (!key || !s.jira?.apiToken) return { url: raw, source: 'none' }
    const i = await getIssue(s.jira, key.toUpperCase())
    return { url: raw, source: 'jira', siteName: 'Jira', title: `${i.key}: ${i.summary}`, state: i.status, author: i.assignee?.displayName, updatedAt: i.updated, description: i.type }
  }

  // Need a login to see anything useful; the card uses what Dispatch already has
  if (host === 'slack.com' || host.endsWith('.slack.com') || host.endsWith('launchdarkly.com')) return { url: raw, source: 'none' }

  return fetchPage(u)
}

/** First paragraph-ish of a Markdown body, for the card */
function summary(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

// ---------- Page fetch that can't reach this machine or the local network ----------

const blocked = new net.BlockList()
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) blocked.addSubnet(a, p, 'ipv4')
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(a, p, 'ipv6')

function isPrivate(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mapped) return blocked.check(mapped, 'ipv4')
  return blocked.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4')
}

/** dns.lookup that refuses private addresses (used for the actual connection, so no rebinding gap) */
const safeLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, '', 4)
    const bad = addrs.find((a) => isPrivate(a.address))
    if (bad || !addrs.length) return cb(new Error('Not previewed: the link points into a private network'), '', 4)
    if ((options as dns.LookupOptions).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addrs)
    cb(null, addrs[0]!.address, addrs[0]!.family)
  })
}

const MAX_BYTES = 512 * 1024

function get(u: URL, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivate(u.hostname.replace(/^\[|\]$/g, ''))) {
      return reject(new Error('Not previewed: the link points into a private network'))
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(
      u,
      {
        lookup: safeLookup,
        timeout: Math.max(1000, deadline - Date.now()),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DispatchLinkPreview/1.0)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'identity',
          'Accept-Language': 'en',
        },
      },
      (res) => {
        const type = String(res.headers['content-type'] ?? '')
        // Not a page (PDF, image, download): headers are enough
        if (res.statusCode && res.statusCode < 300 && !/html|xml/i.test(type)) {
          res.destroy()
          return resolve({ status: res.statusCode, headers: res.headers, body: '' })
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          chunks.push(c)
          // <head> is all we need
          if (size >= MAX_BYTES || /<\/head>/i.test(c.toString('latin1'))) res.destroy()
        })
        const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        res.on('end', done)
        res.on('close', done)
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('The site took too long to answer')))
    req.on('error', reject)
  })
}

async function fetchPage(start: URL): Promise<LinkPreview> {
  const deadline = Date.now() + 6000
  let u = start
  for (let hop = 0; ; hop++) {
    const res = await get(u, deadline)
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= 4) throw new Error('Too many redirects')
      const next = new URL(res.headers.location, u)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('Redirects somewhere that is not a web page')
      u = next
      continue
    }
    const out: LinkPreview = { url: start.href, source: 'page', siteName: u.hostname.replace(/^www\./, '') }
    if (u.href !== start.href) out.finalUrl = u.href
    const type = String(res.headers['content-type'] ?? '').split(';')[0]!.trim()
    if (res.status >= 400) out.error = `The site answered ${res.status}`
    if (type && !/html/i.test(type)) {
      out.contentType = type
      return out
    }
    return { ...out, ...parseHead(res.body, u) }
  }
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** <title>, description, Open Graph / Twitter tags and the icon from a page's <head> */
function parseHead(html: string, base: URL): Partial<LinkPreview> {
  const head = html.slice(0, MAX_BYTES)
  const meta = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    const name = attr('property') ?? attr('name')
    const content = attr('content')
    const k = (name?.[2] ?? name?.[3] ?? name?.[4])?.toLowerCase()
    const v = content?.[2] ?? content?.[3] ?? content?.[4]
    if (k && v && !meta.has(k)) meta.set(k, decode(v))
  }
  const abs = (href?: string) => {
    if (!href) return undefined
    try {
      const x = new URL(href, base)
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : undefined
    } catch {
      return undefined
    }
  }
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]!) : undefined)
  const iconTag = (head.match(/<link\b[^>]*>/gi) ?? []).find((t) => /\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(t))
  const iconHref = iconTag?.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
  return {
    title: title?.slice(0, 300),
    description: (meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description'))?.slice(0, 400),
    siteName: meta.get('og:site_name') ?? base.hostname.replace(/^www\./, ''),
    image: abs(meta.get('og:image') ?? meta.get('twitter:image')),
    favicon: abs(iconHref?.[2] ?? iconHref?.[3] ?? iconHref?.[4]) ?? new URL('/favicon.ico', base).href,
  }
}
