import { Hono } from 'hono'
import { z } from 'zod'
import { getSettings } from '../db.ts'

/**
 * The one Hono app every route module registers on (see ../routes.ts for the order), with the
 * helpers they share.
 */
export const api = new Hono()

api.onError((err, c) => {
  console.error('[api]', err.message)
  return c.json({ error: err.message }, (err as { status?: number }).status === 400 ? 400 : 500)
})

export const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 })

export const jiraCfg = () => {
  const s = getSettings()
  if (!s.jira?.apiToken) throw bad('Jira not configured')
  return s.jira
}
/** Pasted images: up to 10, ~10 MB each (base64) */
export const Images = z
  .array(z.object({ name: z.string().max(200), type: z.string().regex(/^image\//), data: z.string().max(14_000_000) }))
  .max(10)
  .default([])
