<script setup lang="ts">
import { PhCaretDown, PhCaretRight } from '@phosphor-icons/vue'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

/** Collapsible list section: caret, label, count; `#actions` for buttons on the right of the heading. */
defineProps<{ label: string; count: number }>()
const collapsed = defineModel<boolean>('collapsed', { default: false })
</script>

<template>
  <Card class="gap-0 py-0">
    <div class="flex items-center gap-2 pr-2" :class="{ 'border-b': !collapsed }">
      <button class="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-4 text-left" @click="collapsed = !collapsed">
        <PhCaretRight v-if="collapsed" :size="14" /><PhCaretDown v-else :size="14" />
        <span class="min-w-0 text-sm font-semibold"><slot name="label">{{ label }}</slot></span>
        <Badge variant="count">{{ count }}</Badge>
      </button>
      <slot name="actions" />
    </div>
    <div v-show="!collapsed" class="p-1.5">
      <slot />
    </div>
  </Card>
</template>
