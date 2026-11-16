<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { HoverCardTriggerProps } from 'reka-ui'
import { HoverCardTrigger, Primitive } from 'reka-ui'

const props = defineProps<HoverCardTriggerProps>()
const armed = useArmed()
</script>

<template>
  <HoverCardTrigger
    v-if="armed"
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
