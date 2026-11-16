<script setup lang="ts">
/**
 * Full-width grab bar under a section: drag up/down to change the section's height (v-model, px),
 * double-click to go back to `reset`. `target` is the element being sized, measured when a drag starts
 * so the drag begins from what's on screen. It doesn't position itself: the caller places it
 * (e.g. `relative z-10 -my-1` in a column, or `absolute inset-x-0 -top-2.5` on an edge). `line` draws it as a divider line instead of a pill;
 * `invert` is for a bar above the section (dragging up makes it taller).
 */
/** maxAt: the largest it may get, given its height when a drag starts (wins over `max`) */
const props = withDefaults(defineProps<{ target?: () => HTMLElement | null | undefined; min?: number; max?: number; maxAt?: (current: number) => number; reset?: number; line?: boolean; invert?: boolean }>(), {
  min: 48,
  max: () => Math.round(window.innerHeight * 0.7),
})
const height = defineModel<number>({ required: true })

let dragMax: number | null = null
const clamp = (h: number) => Math.round(Math.min(dragMax ?? props.max, Math.max(props.min, h)))

function start(e: PointerEvent) {
  e.preventDefault()
  const bar = e.currentTarget as HTMLElement
  bar.setPointerCapture(e.pointerId)
  const from = e.clientY
  const base = props.target?.()?.offsetHeight ?? height.value
  dragMax = props.maxAt ? Math.max(props.min, props.maxAt(base)) : null
  const move = (ev: PointerEvent) => (height.value = clamp(base + (props.invert ? from - ev.clientY : ev.clientY - from)))
  const end = () => {
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', end)
    bar.removeEventListener('pointercancel', end)
    document.body.style.cursor = ''
    dragMax = null
  }
  document.body.style.cursor = 'row-resize'
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)
}
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 48 : 16
  const up = props.invert ? step : -step
  if (e.key === 'ArrowUp') height.value = clamp(height.value + up)
  else if (e.key === 'ArrowDown') height.value = clamp(height.value - up)
  else return
  e.preventDefault()
}
</script>

<template>
  <div
    role="separator"
    aria-orientation="horizontal"
    aria-label="Drag to resize"
    tabindex="0"
    title="Drag to resize · double-click to reset"
    class="group flex h-5 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none"
    @pointerdown="start"
    @dblclick="reset !== undefined && (height = reset)"
    @keydown="onKey"
  >
    <span v-if="line" class="h-px w-full bg-border transition-all group-hover:h-0.5 group-hover:bg-primary/60 group-focus-visible:h-0.5 group-focus-visible:bg-primary" />
    <span v-else class="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
  </div>
</template>
