<script setup lang="ts">
import { ref } from 'vue'
import type { MenuAction, MenuEntry } from '@/composables/itemMenus'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'

/** The entries of an ItemContextMenu (recursive for submenus; async submenus load when opened) */
defineProps<{ entries: MenuEntry[] }>()

const loaded = ref(new Map<MenuAction, MenuEntry[] | 'loading' | 'error'>())
async function load(a: MenuAction) {
  if (typeof a.children !== 'function' || loaded.value.has(a)) return
  loaded.value.set(a, 'loading')
  try {
    loaded.value.set(a, await a.children())
  } catch {
    loaded.value.set(a, 'error')
  }
}
const childrenOf = (a: MenuAction) => (typeof a.children === 'function' ? loaded.value.get(a) : a.children)
const isAction = (e: MenuEntry): e is MenuAction => typeof e === 'object' && 'label' in e
function select(a: MenuAction) {
  if (a.href) window.open(a.href, '_blank', 'noopener')
  else a.run?.()
}
</script>

<template>
  <template v-for="(e, i) in entries" :key="i">
    <ContextMenuSeparator v-if="e === 'separator'" />
    <ContextMenuLabel v-else-if="!isAction(e)" class="text-xs text-muted-foreground">{{ e.heading }}</ContextMenuLabel>
    <ContextMenuSub v-else-if="e.children" @update:open="(o: boolean) => o && load(e)">
      <ContextMenuSubTrigger :disabled="e.disabled">
        <component :is="e.icon" v-if="e.icon" />
        <span class="min-w-0 flex-1 truncate">{{ e.label }}</span>
        <!-- e.g. the current status, on the right before the caret (like an item's hint) -->
        <span v-if="e.hint" class="max-w-32 truncate text-xs text-muted-foreground">{{ e.hint }}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent class="max-w-80 min-w-44">
        <ContextMenuLabel v-if="childrenOf(e) === 'loading' || childrenOf(e) === undefined" class="text-xs text-muted-foreground">Loading…</ContextMenuLabel>
        <ContextMenuLabel v-else-if="childrenOf(e) === 'error'" class="text-xs text-destructive">Couldn't load</ContextMenuLabel>
        <MenuEntries v-else :entries="childrenOf(e) as MenuEntry[]" />
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem v-else :variant="e.variant" :disabled="e.disabled" @select="select(e)">
      <component :is="e.icon" v-if="e.icon" />
      <span class="min-w-0 flex-1 truncate">{{ e.label }}</span>
      <ContextMenuShortcut v-if="e.hint" class="max-w-40 truncate tracking-normal">{{ e.hint }}</ContextMenuShortcut>
    </ContextMenuItem>
  </template>
</template>
