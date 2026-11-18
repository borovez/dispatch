import { editDescription, withBlocks, withDependency, withoutBlocks, withoutDependency } from '../bodyDeps.ts'
import { z } from 'zod'
import { listPrs, addManualDep, getSettings, removeManualDep, setPrBody } from '../db.ts'
import { normaliseRef } from '../refs.ts'
import { accountForOwner } from '../sync.ts'
import { api, bad } from './shared.ts'

/** Dependencies: add / remove, written into PR descriptions on GitHub */
// ---------- Dependencies ----------
const DepInput = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['merge', 'release']).default('merge'),
  note: z.string().nullish(),
})

/** Edit one synced PR's description on GitHub; returns false when the PR isn't synced (nothing to edit) */
async function editPrBody(id: string, edit: (body: string, repo: string) => string): Promise<boolean> {
  const stored = listPrs().find((s) => s.pr.id === id)
  if (!stored) return false
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.pr.accountId) ?? accountForOwner(accounts, stored.pr.owner)
  if (!acc) throw new Error(`No GitHub account for ${id}`)
  const body = await editDescription(acc, stored.pr.repo, stored.pr.number, (b) => edit(b, stored.pr.repo))
  if (body !== null) setPrBody(id, body)
  return true
}
/** "owner/Repo#12" with the repo's real casing when synced */
const refFor = (id: string) => {
  const p = listPrs().find((s) => s.pr.id === id)?.pr
  return p ? `${p.repo}#${p.number}` : id
}

api.post('/deps', async (c) => {
  const d = DepInput.parse(await c.req.json())
  const from = normaliseRef(d.from)
  const to = normaliseRef(d.to)
  if (!from || !to) throw bad('Use owner/repo#123 or a GitHub PR URL')
  if (from === to) throw bad('A PR cannot depend on itself')
  const settings = getSettings()
  if (!settings.dependencies.writeToDescription) {
    const id = addManualDep(from, to, d.kind, d.note ?? null)
    return c.json({ id, from, to, written: false })
  }
  // The dependent PR's description gets "Depends on: <to>"; with writeBothSides the prerequisite's gets "Blocks: <from>"
  let written = false
  let writtenOther = false
  const warnings: string[] = []
  try {
    written = await editPrBody(from, (b, repo) => withDependency(b, repo, from, to, refFor(to), d.kind))
  } catch (e) {
    warnings.push(`${from}: ${(e as Error).message}`)
  }
  if (settings.dependencies.writeBothSides)
    try {
      writtenOther = await editPrBody(to, (b, repo) => withBlocks(b, repo, to, from, refFor(from), d.kind))
    } catch (e) {
      warnings.push(`${to}: ${(e as Error).message}`)
    }
  // Neither description holds it: keep it in Dispatch
  const id = written || writtenOther ? undefined : addManualDep(from, to, d.kind, d.note ?? null)
  return c.json({ id, from, to, written, writtenOther, error: warnings.join('; ') || undefined })
})

api.delete('/deps/:id', (c) => c.json({ removed: removeManualDep(Number(c.req.param('id'))) }))

/** Remove a dependency that comes from PR descriptions: out of the dependent's "Depends on" and the prerequisite's "Blocks" */
api.post('/deps/remove-from-description', async (c) => {
  const { from, to } = await c.req.json<{ from: string; to: string }>()
  const errors: string[] = []
  for (const [id, edit] of [
    [from, (b: string, repo: string) => withoutDependency(b, repo, to)],
    [to, (b: string, repo: string) => withoutBlocks(b, repo, from)],
  ] as const)
    try {
      await editPrBody(id, edit)
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`)
    }
  if (errors.length) throw bad(errors.join('; '))
  return c.json({ removed: true })
})
