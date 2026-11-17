/**
 * Copy text (and optionally HTML) to the clipboard. Runs synchronously inside the click through a `copy`
 * event, which works while a menu holds focus and in the Mac app; `navigator.clipboard` is the
 * fallback, given 2 s because it can wait forever for focus or a permission.
 */
export async function writeClipboard(text: string, html?: string): Promise<void> {
  let done = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/plain', text)
    if (html) e.clipboardData.setData('text/html', html)
    e.preventDefault()
    done = true
  }
  document.addEventListener('copy', onCopy, true)
  try {
    document.execCommand('copy')
  } catch {
    // Not supported: the async API below
  } finally {
    document.removeEventListener('copy', onCopy, true)
  }
  if (done) return
  const write = html && typeof ClipboardItem !== 'undefined'
    ? navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    : navigator.clipboard.writeText(text)
  await Promise.race([write, new Promise((_, reject) => setTimeout(() => reject(new Error('The clipboard did not answer')), 2000))])
}
