<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { ContextMenuRootEmits, ContextMenuRootProps } from 'reka-ui'
import { ContextMenuRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<ContextMenuRootProps>()
const emits = defineEmits<ContextMenuRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
const armed = useArmed()
</script>

<template>
  <ContextMenuRoot
    v-if="armed"
    data-slot="context-menu"
    v-bind="forwarded"
  >
    <slot />
  </ContextMenuRoot>
  <slot v-else />
</template>
