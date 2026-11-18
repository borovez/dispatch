import { linkPreview } from '../linkPreview.ts'
import { getSettings, getSyncState, getUiPrefs, saveSettings, saveUiPrefs } from '../db.ts'
import { startUpdate, updateStatus, VERSION } from '../updates.ts'
import { buildOverview } from '../model.ts'
import { runSync } from '../sync.ts'
import { api, bad } from './shared.ts'

/** Health, updates, overview and sync; link hover card; UI prefs */
/** Tokens never leave the server. */

api.get('/health', (c) => c.json({ ok: true, version: VERSION }))

/** Whether a newer release is out, and whether this install can update itself (`?refresh=1` checks GitHub now) */
api.get('/update', async (c) => c.json(await updateStatus(c.req.query('refresh') === '1')))
/** Pull, install, rebuild and restart in the background; the app reloads when /health reports the new version */
api.post('/update', async (c) => {
  await startUpdate()
  return c.json({ started: true })
})

api.get('/overview', (c) => c.json(buildOverview()))

api.post('/sync', async (c) => {
  await runSync()
  return c.json(buildOverview())
})

/** Progress of the running sync (or the last one), polled by the header while syncing */
api.get('/sync/status', (c) => c.json(getSyncState()))

/** Header toggle: switch background sync on/off without sending the whole settings object */
api.put('/sync/auto', async (c) => {
  const { enabled } = (await c.req.json()) as { enabled: boolean }
  const s = getSettings()
  saveSettings({ ...s, sync: { ...s.sync, auto: !!enabled } })
  return c.json({ enabled: !!enabled })
})

// ---------- Link hover card ----------
api.get('/link-preview', async (c) => {
  const url = c.req.query('url') ?? ''
  if (!/^https?:\/\//i.test(url) || url.length > 2048) throw bad('Not a web link')
  return c.json(await linkPreview(url))
})

// ---------- UI prefs ----------
api.get('/prefs', (c) => c.json(getUiPrefs()))
api.put('/prefs', async (c) => {
  saveUiPrefs(await c.req.json())
  return c.json({ ok: true })
})
