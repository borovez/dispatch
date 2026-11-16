<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { HoverCardRootEmits, HoverCardRootProps } from 'reka-ui'
import { HoverCardRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<HoverCardRootProps>()
const emits = defineEmits<HoverCardRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
const armed = useArmed()
</script>

<template>
  <HoverCardRoot
    v-if="armed"
    v-slot="slotProps"
    data-slot="hover-card"
    v-bind="forwarded"
  >
    <slot v-bind="slotProps" />
  </HoverCardRoot>
  <slot v-else v-bind="{ open: false }" />
</template>
