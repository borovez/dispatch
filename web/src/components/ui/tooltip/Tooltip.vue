<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { TooltipRootEmits, TooltipRootProps } from 'reka-ui'
import { TooltipRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<TooltipRootProps>()
const emits = defineEmits<TooltipRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
const armed = useArmed()
</script>

<template>
  <TooltipRoot
    v-if="armed"
    v-slot="slotProps"
    data-slot="tooltip"
    v-bind="forwarded"
  >
    <slot v-bind="slotProps" />
  </TooltipRoot>
  <slot v-else v-bind="{ open: false }" />
</template>
