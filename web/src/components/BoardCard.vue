<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useRowArming } from '@/composables/arming'
import { openInAppOr } from '@/lib/external'
import PrCard from './PrCard.vue'
import PrHover from './PrHover.vue'

/**
 * A PR on the board: PrCard with the hover preview, kept cheap like list rows (`lazy-row`, and its
 * hover card and popovers mount once it nears the view or is hovered or focused). Not used for graph
 * nodes, where Vue Flow measures the cards.
 */
const props = defineProps<{ pr: PrView }>()
const deck = useDeck()
const card = ref<InstanceType<typeof PrCard>>()
useRowArming(computed(() => card.value?.$el as HTMLElement | undefined))
</script>

<template>
  <PrHover :pr="props.pr">
    <PrCard
      ref="card"
      :id="pr.id"
      :pr="pr"
      class="lazy-row cursor-pointer [contain-intrinsic-size:auto_6rem]"
      @click="openInAppOr($event, pr.url, () => (deck.selectedId = pr.id))"
    />
  </PrHover>
</template>
