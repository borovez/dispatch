/**
 * Markdown (what the reply box writes) → Slack mrkdwn (what chat.postMessage takes):
 * **bold** → *bold*, *italic* / _italic_ → _italic_, ~~strike~~ → ~strike~, [text](url) → <url|text>,
 * # headings → bold lines, - / * bullets → •. Code spans and blocks are left alone; &, < and > are
 * escaped as Slack asks (except a quote's leading >). `mentions` turns @Name into <@ID> (longest names
 * first); with `labels` the mention keeps its name (<@ID|Name>) for showing it in Dispatch.
 */
export function markdownToMrkdwn(md: string, opts: { mentions?: Record<string, string>; labels?: boolean } = {}): string {
  const names = Object.keys(opts.mentions ?? {})
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const mention = names.length ? new RegExp(`(^|[^\\w@])@(${names.map(escapeRe).join('|')})(?![\\w])`, 'g') : null
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const prose = (text: string) => {
    // Links first, kept out of the escaping and the emphasis rules
    const links: string[] = []
    let s = text.replace(/\[([^\]\n]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, (_, label: string, url: string) => {
      links.push(`<${url}|${esc(label).replace(/\|/g, '/')}>`)
      return `\u0002${links.length - 1}\u0002`
    })
    s = s
      .split('\n')
      .map((line) => {
        const quote = /^\s*> ?/.exec(line)?.[0] ?? ''
        let l = esc(line.slice(quote.length))
        l = l.replace(/^(\s*)#{1,6}\s+(.+?)\s*#*\s*$/, (_, sp: string, h: string) => `${sp}**${h.replace(/\*\*/g, '')}**`)
        l = l.replace(/^(\s*)[-*+]\s+/, '$1• ')
        return (quote ? '> ' : '') + l
      })
      .join('\n')
    s = s
      .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a?: string, b?: string) => `\u0001${a ?? b}\u0001`)
      .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '_$1_')
      .replace(/~~([^~\n]+)~~/g, '~$1~')
      .replace(/\u0001/g, '*')
    if (mention) s = s.replace(mention, (_, pre: string, name: string) => `${pre}<@${opts.mentions![name]}${opts.labels ? `|${name}` : ''}>`)
    return s.replace(/\u0002(\d+)\u0002/g, (_, i: string) => links[Number(i)])
  }

  // Code blocks and spans pass through (escaped only)
  return md
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, i) => (i % 2 ? esc(part) : prose(part)))
    .join('')
    .trim()
}
