import { inject, nextTick, onBeforeUnmount, provide, readonly, ref, watch, type InjectionKey, type Ref } from 'vue'

/**
 * Lazy list rows. A row calls `useRowArming(el)`; until it is "armed" the overlay wrappers inside it
 * (Tooltip, Popover, HoverCard, ContextMenu in components/ui) render only their trigger element, without
 * reka's roots, portals and listeners. A row arms when it comes within ~a screen of the viewport (one
 * shared IntersectionObserver), or on first hover or focus, and stays armed. Outside a row everything
 * is armed, so the components behave as usual.
 */
const KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol('armed')
const ALWAYS = readonly(ref(true))

export const useArmed = () => inject(KEY, ALWAYS)

let io: IntersectionObserver | undefined
const onVisible = new WeakMap<Element, () => void>()
const observer = () =>
  (io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) onVisible.get(e.target)?.()
    },
    { rootMargin: '800px 0px' },
  ))

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function useRowArming(el: Readonly<Ref<HTMLElement | null | undefined>>) {
  const armed = ref(false)
  provide(KEY, readonly(armed))
  let cur: HTMLElement | null = null

  function stop() {
    if (!cur) return
    observer().unobserve(cur)
    onVisible.delete(cur)
    cur.removeEventListener('pointerover', arm)
    cur.removeEventListener('focusin', onFocus)
    cur = null
  }
  function arm() {
    armed.value = true
    stop()
  }
  /** Arming re-renders the row, so focus is put back on the same control */
  function onFocus(e: FocusEvent) {
    const row = cur
    const index = row ? [...row.querySelectorAll(FOCUSABLE)].indexOf(e.target as Element) : -1
    arm()
    nextTick(() => {
      if (index < 0 || document.activeElement !== document.body) return
      ;(el.value?.querySelectorAll<HTMLElement>(FOCUSABLE)[index] ?? el.value)?.focus()
    })
  }

  watch(
    el,
    (e) => {
      if (armed.value) return
      stop()
      if (!e) return
      cur = e
      onVisible.set(e, arm)
      observer().observe(e)
      e.addEventListener('pointerover', arm)
      e.addEventListener('focusin', onFocus)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(stop)
  return armed
}
