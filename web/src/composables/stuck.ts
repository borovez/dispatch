import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Whether a `position: sticky` element is stuck: the page has scrolled and the element sits at its
 * own `top` (read from its computed style, so any top value or CSS variable works). Checked on scroll
 * and resize, once per frame.
 */
export function useStuck(el: Ref<HTMLElement | null | undefined>) {
  const stuck = ref(false)
  let frame = 0
  function check() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const e = el.value
      if (!e) return
      const top = parseFloat(getComputedStyle(e).top) || 0
      stuck.value = window.scrollY > 0 && e.getBoundingClientRect().top <= top + 1
    })
  }
  onMounted(() => {
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check, { passive: true })
    check()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', check)
    window.removeEventListener('resize', check)
    cancelAnimationFrame(frame)
  })
  return stuck
}
