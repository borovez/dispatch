<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { PopoverRootEmits, PopoverRootProps } from 'reka-ui'
import { PopoverRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<PopoverRootProps>()
const emits = defineEmits<PopoverRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
const armed = useArmed()
</script>

<template>
  <PopoverRoot
    v-if="armed"
    v-slot="slotProps"
    data-slot="popover"
    v-bind="forwarded"
  >
    <slot v-bind="slotProps" />
  </PopoverRoot>
  <slot v-else v-bind="{ open: false }" />
</template>
