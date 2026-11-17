/** "owner/name#12" → its parts (PR ids are lowercase; GitHub URLs are case-insensitive) */
export function parsePrRef(id: string): { owner: string; name: string; number: number } | null {
  const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(id)
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : null
}
