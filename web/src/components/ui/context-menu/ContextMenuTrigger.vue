<script setup lang="ts">
import { useArmed } from '@/composables/arming'
import type { ContextMenuTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '@/lib/utils'
import { ContextMenuTrigger, useForwardProps, Primitive } from 'reka-ui'

const props = defineProps<ContextMenuTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
const armed = useArmed()
</script>

<template>
  <ContextMenuTrigger
    v-if="armed"
    data-slot="context-menu-trigger"
    v-bind="forwardedProps"
    :class="cn('select-none', props.class)"
  >
    <slot />
  </ContextMenuTrigger>
  <Primitive
    v-else
    :as="props.as ?? 'span'"
    :as-child="props.asChild"
    :class="cn('select-none', props.class)"
  >
    <slot />
  </Primitive>
</template>
