import { nextTick, watch, type Ref } from 'vue'

/**
 * Arrow-key movement through a suggestion list (pickers, menus, search): Up / Down wrap around, skip
 * rows that can't be picked, do nothing on an empty list, keep the active row in range when the list
 * shrinks, and scroll the row marked `data-active` into view. Enter and other keys stay with the
 * caller (what Enter does differs: pick, toggle, go, or let the form submit).
 *
 *   const nav = useListNav({ items: () => rows.value, active, container: () => list.value })
 *   function onKey(e) { if (nav.onArrow(e)) return; if (e.key === 'Enter') … }
 */
export function useListNav<T>(opts: {
  items: () => readonly T[]
  /** The caller's active index (it may also set it: mouse hover, reset on a new query) */
  active: Ref<number>
  /** Rows shown but not pickable */
  disabled?: (item: T) => boolean
  /** Element holding the rows; the one with `data-active` is scrolled into view after a move */
  container?: () => Element | null | undefined
}) {
  const { items, active, disabled, container } = opts

  // A shorter list (new query, filter) never leaves the active row past its end
  watch(
    () => items().length,
    (n) => {
      if (active.value >= n) active.value = Math.max(0, n - 1)
    },
  )

  /** Index of the first pickable row (0 when there is none) */
  const first = () => Math.max(0, disabled ? items().findIndex((it) => !disabled(it)) : 0)

  /** Move one row down (1) or up (-1); false when there is nothing to move to */
  function move(dir: 1 | -1): boolean {
    const list = items()
    const n = list.length
    if (!n) return false
    let i = Number.isInteger(active.value) ? active.value : 0
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n
      if (!disabled?.(list[i]!)) break
    }
    active.value = i
    if (container) nextTick(() => container()?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }))
    return true
  }

  /** Handles ArrowDown / ArrowUp (and stops the caret / page moving); true when it did */
  function onArrow(e: KeyboardEvent): boolean {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
    return true
  }

  return { move, onArrow, first }
}
