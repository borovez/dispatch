import './quiet.ts'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DB_PATH, getSettings, getSyncState, saveSyncState } from './db.ts'
import { api } from './routes.ts'
import { runSync } from './sync.ts'
import { updateStatus } from './updates.ts'

const PORT = Number(process.env.DISPATCH_PORT ?? process.env.PRDECK_PORT ?? 4317)
// Bound to loopback only: this process holds your GitHub and Jira tokens.
const HOST = '127.0.0.1'

const app = new Hono()

/**
 * Local-only guard. Binding to loopback keeps other machines out, but not web pages open in a browser on
 * this one, which can send requests to 127.0.0.1:
 * - Host must be a loopback name, so a DNS-rebinding page (evil.example → 127.0.0.1) gets nothing.
 * - Writes (anything but GET / HEAD / OPTIONS) must come from Dispatch itself or a non-browser client
 *   (curl, the MCP server, Claude Code): a browser's Origin must be Dispatch's own (this port, or the Vite
 *   dev server), Sec-Fetch-Site may not be cross-site, and a body must be JSON (a cross-site form or
 *   text/plain POST is refused, and JSON from another origin needs a CORS preflight Dispatch never grants).
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const DEV_PORT = Number(process.env.DISPATCH_DEV_PORT ?? 5317)
const hostOf = (h: string) => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]).toLowerCase()
app.use('*', async (c, next) => {
  const host = c.req.header('host')
  if (host && !LOOPBACK.has(hostOf(host))) return c.json({ error: 'Dispatch only answers on 127.0.0.1 / localhost' }, 403)
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
  const origin = c.req.header('origin')
  if (origin) {
    let ok = false
    try {
      const u = new URL(origin)
      ok = LOOPBACK.has(u.hostname.toLowerCase()) && [PORT, DEV_PORT].includes(Number(u.port || (u.protocol === 'https:' ? 443 : 80)))
    } catch {
      /* "null" or garbage: refused */
    }
    if (!ok) return c.json({ error: `Requests from ${origin} are not allowed` }, 403)
  }
  if (c.req.header('sec-fetch-site') === 'cross-site') return c.json({ error: 'Cross-site requests are not allowed' }, 403)
  const hasBody = Number(c.req.header('content-length') ?? 0) > 0 || !!c.req.header('transfer-encoding')
  if (hasBody && !(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return c.json({ error: 'Send JSON (Content-Type: application/json)' }, 415)
  }
  return next()
})

app.route('/api', api)

// In production, serve the built Vue app.
// The desktop app bundles the server and points it at its copy of the web app
const dist = process.env.DISPATCH_WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: dist }))
  // SPA fallback. Read on each request: a rebuild renames the hashed assets it points to
  app.get('*', (c) => c.html(readFileSync(`${dist}/index.html`, 'utf8')))
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`dispatch API on http://${HOST}:${PORT}  (db: ${DB_PATH})`)
})

// A sync cut short by a restart left "running" behind; mark it stopped, with unfinished steps as queued
const stale = getSyncState()
if (stale.running) {
  saveSyncState({
    ...stale,
    running: false,
    steps: stale.steps?.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail: 'Interrupted (server restarted)' } : s)),
  })
}

// Look for a new release at start and every six hours (cached; the app reads it from /api/update)
const checkUpdates = () => updateStatus().catch(() => {})
checkUpdates()
setInterval(checkUpdates, 60 * 60_000)

// Background sync loop – re-reads the interval every tick so settings changes apply.
let last = 0
setInterval(() => {
  const s = getSettings()
  if (!s.sync.auto || !s.github.accounts.some((a) => a.token)) return
  const minutes = Math.max(1, Number(s.sync.intervalMinutes) || 5)
  if (Date.now() - last < minutes * 60_000) return
  last = Date.now()
  runSync().catch((e) => console.error('[sync]', e))
}, 30_000)
