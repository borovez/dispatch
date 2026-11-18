<script setup lang="ts">
import { inject, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useArmed } from '@/composables/arming'
import { innerTrigger } from '@/lib/hoverTargets'
import type { HoverCardTriggerProps } from 'reka-ui'
import { HoverCardTrigger, Primitive } from 'reka-ui'
import { HOVER_CARD_INNER } from './inner'

const props = defineProps<HoverCardTriggerProps>()
const armed = useArmed()

// The innermost trigger under the pointer wins: on a link with its own card (or a nested card's
// trigger) inside this one, this card closes / doesn't open; back on this card's own area, it opens
// again after its delay (reka only opens on entering the trigger, which already happened).
const ctx = inject(HOVER_CARD_INNER, null)
const trigger = ref<{ $el?: Element } | null>(null)
const el = () => (trigger.value?.$el instanceof Element ? trigger.value.$el : null)
let wasInner = false
let timer: ReturnType<typeof setTimeout> | undefined
useEventListener(el, 'pointerover', (e: PointerEvent) => {
  const root = el()
  if (!ctx || !root || e.pointerType === 'touch') return
  const inner = !!innerTrigger(e.target, root)
  clearTimeout(timer)
  ctx.set(inner)
  if (inner) wasInner = true
  else if (wasInner) {
    wasInner = false
    timer = setTimeout(() => ctx.reopen(), ctx.openDelay())
  }
})
useEventListener(el, 'pointerleave', () => {
  clearTimeout(timer)
  wasInner = false
  ctx?.set(false)
})
</script>

<template>
  <HoverCardTrigger
    v-if="armed"
    ref="trigger"
    data-slot="hover-card-trigger"
    v-bind="props"
  >
    <slot />
  </HoverCardTrigger>
  <Primitive
    v-else
    :as="props.as ?? 'a'"
    :as-child="props.asChild"
  >
    <slot />
  </Primitive>
</template>
