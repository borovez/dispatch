<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { PhLockSimple, PhLockSimpleOpen, PhX } from '@phosphor-icons/vue'
import { useLayout } from '@/stores/layout'
import { LAYER_OPEN, onEscape } from '@/composables/escape'
import { Button } from '@/components/ui/button'
import PanelHistoryNav from './PanelHistoryNav.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Right-hand detail panel (PR, Slack message): resizable, closes on Escape and on a click outside
 * it unless "keep open" is on. Header, actions, body and footer are slots. With v-model:footer-height
 * (px, 0 = fit the content) the line above the footer can be dragged to size the footer against the
 * body; double-click sets it to 0 (the parent's default). A sized footer is a column: give its content `flex-1`.
 */
const props = defineProps<{ open: boolean }>()
const footerHeight = defineModel<number>('footerHeight')
const emit = defineEmits<{ close: [] }>()
const layout = useLayout()
onEscape(() => props.open && (emit('close'), true))

/** Clicks that shouldn't close it: other items (they switch the panel), and layers on top of it */
const KEEP_OPEN_TARGETS =
  '[data-side-panel], [data-pr-id], [data-slack-id], [data-jira-id], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-sonner-toaster], [data-reka-popper-content-wrapper]'
useEventListener(
  document,
  'pointerdown',
  (e: PointerEvent) => {
    if (!props.open || layout.prefs.panelPinned || e.button !== 0) return
    if ((e.target as HTMLElement).closest?.(KEEP_OPEN_TARGETS) || document.querySelector(LAYER_OPEN)) return
    emit('close')
  },
  { capture: true },
)

const MIN_W = 380
/** Widest the panel can be: 1100px, or the window minus a strip of the page */
const maxW = () => Math.max(MIN_W, Math.min(1100, window.innerWidth - 80))
/** Double-click the edge: snap to the widest size, or back to the narrowest when it's already wide */
function toggleWidth() {
  const w = layout.prefs.drawerWidth
  layout.prefs.drawerWidth = w < (MIN_W + maxW()) / 2 ? maxW() : MIN_W
}
function startResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = layout.prefs.drawerWidth
  const onMove = (e: MouseEvent) => (layout.prefs.drawerWidth = Math.min(maxW(), Math.max(MIN_W, startW + startX - e.clientX)))
  const onUp = () => (window.removeEventListener('mousemove', onMove), window.removeEventListener('mouseup', onUp))
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  ev.preventDefault()
}

// ---- No page scrollbar beside an open panel (see html.side-panel-open in style.css)
let mine = false
function hidePageScrollbar(on: boolean) {
  if (on === mine) return
  mine = on
  openPanels += on ? 1 : -1
  const root = document.documentElement
  if (openPanels > 0 && !root.classList.contains('side-panel-open')) {
    root.style.setProperty('--page-sbw', `${window.innerWidth - root.clientWidth}px`)
    root.classList.add('side-panel-open')
  } else if (openPanels === 0) root.classList.remove('side-panel-open')
}
watch(() => props.open, hidePageScrollbar, { immediate: true })
onBeforeUnmount(() => hidePageScrollbar(false))

// ---- Scrolling inside the panel never scrolls the page behind it
/** Can this element scroll further in the wheel's direction? */
function canScroll(el: HTMLElement, dx: number, dy: number) {
  const st = getComputedStyle(el)
  const y = dy !== 0 && /(auto|scroll)/.test(st.overflowY) && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  const x = dx !== 0 && /(auto|scroll)/.test(st.overflowX) && (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  return x || y
}
function onWheel(e: WheelEvent) {
  if (e.ctrlKey) return // pinch zoom
  const panel = e.currentTarget as HTMLElement
  for (let el = e.target as HTMLElement | null; el && el !== panel; el = el.parentElement) if (canScroll(el, e.deltaX, e.deltaY)) return
  e.preventDefault()
}

// ---- Footer height
const footerEl = ref<HTMLElement | null>(null)
function startFooterResize(ev: PointerEvent) {
  ev.preventDefault()
  const bar = ev.currentTarget as HTMLElement
  bar.setPointerCapture(ev.pointerId)
  const startY = ev.clientY
  const startH = footerEl.value?.offsetHeight ?? 0
  const max = () => Math.round(window.innerHeight * 0.8)
  const move = (e: PointerEvent) => (footerHeight.value = Math.round(Math.min(max(), Math.max(80, startH + startY - e.clientY))))
  const end = () => {
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', end)
    bar.removeEventListener('pointercancel', end)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'row-resize'
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="open"
      data-side-panel
      class="fixed inset-y-0 overscroll-contain right-0 z-40 flex w-full max-w-full flex-col border-l bg-background shadow-2xl sm:w-(--panel-w)"
      :style="{ '--panel-w': layout.prefs.drawerWidth + 'px' }"
      @wheel="onWheel"
    >
      <!-- z-30: the body's scroll area is positioned and would otherwise cover the handle below the header -->
      <div
        class="absolute inset-y-0 -left-1 z-30 w-2.5 cursor-col-resize transition-colors hover:bg-primary/30 max-sm:hidden"
        title="Drag to resize · double-click for widest / narrowest"
        @mousedown="startResize"
        @dblclick="toggleWidth"
      />
      <!-- Narrow screens: the buttons get their own row above the title -->
      <header class="flex flex-wrap items-start gap-x-2 gap-y-1 border-b p-3 sm:flex-nowrap sm:p-4">
        <div class="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto"><slot name="header" /></div>
        <span class="flex-1 sm:hidden" />
        <PanelHistoryNav />
        <slot name="actions" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-pressed="!!layout.prefs.panelPinned"
              :aria-label="layout.prefs.panelPinned ? 'Close when clicking outside' : 'Keep open when clicking outside'"
              @click="layout.prefs.panelPinned = !layout.prefs.panelPinned"
            >
              <PhLockSimple v-if="layout.prefs.panelPinned" weight="fill" class="text-primary" /><PhLockSimpleOpen v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ layout.prefs.panelPinned ? 'Kept open: click to close on outside clicks again' : 'Keep open when clicking outside' }}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')"><PhX /></Button>
      </header>
      <slot />
      <footer
        v-if="$slots.footer"
        ref="footerEl"
        :class="
          footerHeight
            ? 'relative flex shrink-0 flex-col items-stretch justify-start gap-2 border-t bg-background p-3'
            : 'relative flex shrink-0 flex-wrap items-center gap-2 border-t bg-background p-3'
        "
        :style="footerHeight ? { height: `${footerHeight}px` } : undefined"
      >
        <!-- The line above the footer: drag to size the footer against the body -->
        <div
          v-if="footerHeight !== undefined"
          class="group absolute inset-x-0 -top-2.5 z-30 flex h-5 cursor-row-resize items-center"
          title="Drag to resize · double-click to reset"
          @pointerdown="startFooterResize"
          @dblclick="footerHeight = 0"
        >
          <span class="h-0.5 w-full transition-colors group-hover:bg-primary/60" />
        </div>
        <slot name="footer" />
      </footer>
    </aside>
  </Transition>
</template>

<script lang="ts">
/** Side panels open right now (the PR, Slack and Jira panels can hand over to each other) */
let openPanels = 0
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.18s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
