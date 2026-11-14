<script setup lang="ts">
import { ref } from 'vue'
import type { MenuEntry } from '@/composables/itemMenus'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import MenuEntries from './MenuEntries.vue'

/**
 * Right-click menu around a list item. `entries` is called when the menu opens, so rows don't build
 * menus they never show. The browser's own menu stays for Shift+right-click and when text is selected
 * (copy, look up). The trigger is `display: contents`, so it doesn't change the item's layout.
 */
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ entries: () => MenuEntry[]; as?: 'div' | 'span' }>(), { as: 'div' })
const items = ref<MenuEntry[]>([])

function onContextMenu(e: MouseEvent) {
  const sel = window.getSelection()
  const selected = sel && !sel.isCollapsed && sel.toString().trim() && (e.currentTarget as Node).contains(sel.anchorNode)
  // Leave the native menu: stop the event before reka's own listener on the same element sees it
  if (e.shiftKey || selected) return e.stopImmediatePropagation()
  items.value = props.entries()
}
</script>

<template>
  <ContextMenu :modal="false">
    <ContextMenuTrigger :as="as" class="contents" v-bind="$attrs" @contextmenu.capture="onContextMenu">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent class="w-60" @click.stop>
      <MenuEntries :entries="items" />
    </ContextMenuContent>
  </ContextMenu>
</template>
