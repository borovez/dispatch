<script setup lang="ts">
import { computed } from 'vue'
import { useDeck } from '@/stores/deck'
import { usePrMenu } from '@/composables/itemMenus'
import ItemContextMenu from './ItemContextMenu.vue'
import PrHover from './PrHover.vue'

/** "#123" that opens the PR panel, with the PR hover preview and its right-click menu (lists that show only the number) */
const props = defineProps<{ id: string; number: number }>()
const deck = useDeck()
const prMenu = usePrMenu()
const pr = computed(() => deck.byId.get(props.id) ?? null)
</script>

<template>
  <ItemContextMenu as="span" :entries="() => prMenu.byId(id)">
    <PrHover v-if="pr" :pr="pr" side="bottom">
      <button type="button" class="font-mono text-primary hover:underline" @click="deck.selectedId = id">#{{ number }}</button>
    </PrHover>
    <button v-else type="button" class="font-mono text-primary hover:underline" @click="deck.selectedId = id">#{{ number }}</button>
  </ItemContextMenu>
</template>
