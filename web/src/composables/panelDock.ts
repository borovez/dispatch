import { computed, ref, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'

/**
 * The left planner (ReleasePlanner) and the right side panel (SidePanel) dock together: when both
 * are open and would touch or overlap, they snap edge to edge and share the window: the right panel
 * takes what the planner leaves, and dragging either inner edge moves the shared seam. Detach lets
 * each keep its own width again (overlap allowed); dragging one into the other snaps them back.
 */
export const PANEL_MIN = 380

/**
 * Which panel I used last (clicked, focused or opened): Escape closes that one when both are open.
 * Set by ReleasePlanner ('planner') and SidePanel ('side').
 */
export const lastPanel = ref<'planner' | 'side'>('side')
const SNAP_GAP = 8
/** Detached: the space left between them */
const DETACH_GAP = 32

export function usePanelDock() {
  const deck = useDeck()
  const layout = useLayout()
  const planner = layout.view('release-planner', { width: 520, repo: '', detached: false })
  const { width: winW } = useWindowSize()

  const both = computed(() => deck.plannerOpen && !!deck.currentPanel && winW.value >= 640)
  const touching = () => planner.width + layout.prefs.drawerWidth >= winW.value - SNAP_GAP
  // Detached is about this pair of panels: closing either one forgets it
  watch(both, (b) => !b && planner.detached && (planner.detached = false))
  /** Docked: both open, not detached, and their widths reach each other */
  const snapped = computed(() => both.value && !planner.detached && planner.width + layout.prefs.drawerWidth >= winW.value - SNAP_GAP)
  /** The planner's width as shown (docked: leaves the right panel its minimum) */
  const plannerW = computed(() => (snapped.value ? Math.min(planner.width, winW.value - PANEL_MIN) : planner.width))
  /** The right panel's width as shown (docked: the rest of the window) */
  const drawerW = computed(() => (snapped.value ? winW.value - plannerW.value : layout.prefs.drawerWidth))

  const clampPlanner = (w: number) => Math.max(PANEL_MIN, Math.min(winW.value - (both.value ? PANEL_MIN : 80), w))
  /** Drag the planner's right edge: docked, the seam moves; reaching the right panel docks them */
  function setPlannerWidth(w: number) {
    const docked = snapped.value
    const wasTouching = touching()
    planner.width = clampPlanner(w)
    // Docked: the right panel keeps meeting it (its stored width follows, so a narrower planner stays docked)
    if (docked) layout.prefs.drawerWidth = winW.value - planner.width
    // Detached: they dock again only when this drag brings them together (not while already overlapping)
    else if (both.value && !wasTouching && touching()) planner.detached = false
  }
  /** Drag the right panel's left edge: docked, the seam moves (the planner gets the rest) */
  function setDrawerWidth(w: number, max: number) {
    if (snapped.value) {
      planner.width = clampPlanner(winW.value - Math.max(PANEL_MIN, w))
      layout.prefs.drawerWidth = winW.value - planner.width
      return
    }
    const wasTouching = touching()
    layout.prefs.drawerWidth = Math.min(max, Math.max(PANEL_MIN, w))
    if (both.value && !wasTouching && touching()) planner.detached = false
  }
  /** Each panel keeps its own width again (they may overlap) */
  function detach() {
    planner.detached = true
    // Docked, the right panel may have grown past its usual widest: back within it
    let drawer = Math.max(PANEL_MIN, Math.min(layout.prefs.drawerWidth, 1100, winW.value - 80))
    // Then a real gap between them: the planner gives way first, then the right panel, down to their minimums
    let plan = Math.min(planner.width, winW.value - drawer - DETACH_GAP)
    if (plan < PANEL_MIN) {
      plan = PANEL_MIN
      drawer = Math.max(PANEL_MIN, winW.value - PANEL_MIN - DETACH_GAP)
    }
    planner.width = plan
    layout.prefs.drawerWidth = drawer
  }
  return { snapped, both, plannerW, drawerW, setPlannerWidth, setDrawerWidth, detach }
}
