/** Styles that decide where text wraps, copied onto the measuring div */
const PROPS = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak', 'scrollbarGutter',
] as const

/**
 * Where character `pos` of a textarea is drawn, in viewport px (top and bottom of its line), measured
 * with an off-screen copy of the textarea's text and wrapping.
 */
export function caretCoords(el: HTMLTextAreaElement, pos: number): { left: number; top: number; bottom: number } {
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  for (const p of PROPS) (div.style as unknown as Record<string, string>)[p] = cs[p]
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden', whiteSpace: 'pre-wrap', height: 'auto' })
  div.textContent = el.value.slice(0, pos)
  const mark = document.createElement('span')
  mark.textContent = el.value.slice(pos) || '.'
  div.appendChild(mark)
  document.body.appendChild(div)
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25
  const rect = el.getBoundingClientRect()
  const top = rect.top + mark.offsetTop - el.scrollTop
  const left = rect.left + mark.offsetLeft - el.scrollLeft
  document.body.removeChild(div)
  return { left, top, bottom: top + line }
}
