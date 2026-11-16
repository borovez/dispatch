<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { PopoverTriggerProps } from 'reka-ui'
import { PopoverTrigger, Primitive } from 'reka-ui'

const props = defineProps<PopoverTriggerProps>()
const armed = useArmed()
</script>

<template>
  <PopoverTrigger
    v-if="armed"
    data-slot="popover-trigger"
    v-bind="props"
  >
    <slot />
  </PopoverTrigger>
  <Primitive
    v-else
    :as="props.as ?? 'button'"
    :as-child="props.asChild"
  >
    <slot />
  </Primitive>
</template>
