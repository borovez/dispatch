<script setup lang="ts">
import { provide, ref } from 'vue'
import { HOVER_CARD_INNER } from './inner'
import { useArmed } from '@/composables/arming'
import { useOneHoverCard } from '@/composables/oneHoverCard'
import type { HoverCardRootEmits, HoverCardRootProps } from 'reka-ui'
import { HoverCardRoot, useForwardProps } from 'reka-ui'

// `open: undefined` keeps it uncontrolled unless the parent passes `open` (Vue would cast a missing boolean to false)
const props = withDefaults(defineProps<HoverCardRootProps>(), { open: undefined })
const emits = defineEmits<HoverCardRootEmits>()

// Props only: update:open is emitted from setOpen (forwarding it too would emit twice)
const forwarded = useForwardProps(props)
const armed = useArmed()

// One hover card open at a time across the app (composables/oneHoverCard.ts); cards inside this
// one's content don't close it. Local state backs an uncontrolled card; a controlled one is told
// through update:open.
const isOpen = ref(props.defaultOpen ?? false)
const overInner = ref(false)
// The trigger reports when the pointer moves onto / off an inner trigger (HoverCardTrigger.vue)
provide(HOVER_CARD_INNER, {
  set(inner: boolean) {
    overInner.value = inner
    if (inner && (props.open ?? isOpen.value)) setOpen(false)
  },
  reopen: () => setOpen(true),
  openDelay: () => props.openDelay ?? 700,
})
const one = useOneHoverCard(() => setOpen(false))
function setOpen(v: boolean) {
  // Pointer on an inner trigger (a link with its own card, a nested card's trigger): that one wins
  if (v && overInner.value) return
  if (v) one.claim()
  else one.release()
  if (isOpen.value === v && props.open === undefined) return
  isOpen.value = v
  emits('update:open', v)
}
</script>

<template>
  <HoverCardRoot
    v-if="armed"
    v-slot="slotProps"
    data-slot="hover-card"
    v-bind="forwarded"
    :open="props.open ?? isOpen"
    @update:open="setOpen"
  >
    <slot v-bind="slotProps" />
  </HoverCardRoot>
  <slot v-else v-bind="{ open: false }" />
</template>
