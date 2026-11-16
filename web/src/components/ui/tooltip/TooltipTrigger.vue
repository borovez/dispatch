<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { TooltipTriggerProps } from 'reka-ui'
import { TooltipTrigger, Primitive } from 'reka-ui'

const props = defineProps<TooltipTriggerProps>()
const armed = useArmed()
</script>

<template>
  <TooltipTrigger
    v-if="armed"
    data-slot="tooltip-trigger"
    v-bind="props"
  >
    <slot />
  </TooltipTrigger>
  <Primitive
    v-else
    :as="props.as ?? 'button'"
    :as-child="props.asChild"
  >
    <slot />
  </Primitive>
</template>
