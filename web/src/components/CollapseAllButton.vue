<script setup lang="ts">
import { PhArrowsInLineVertical, PhArrowsOutLineVertical } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'

/** Expand all / Collapse all for a page of collapsible groups */
defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <Button variant="ghost" size="sm" class="text-muted-foreground" :title="collapsed ? 'Expand all' : 'Collapse all'" @click="emit('toggle')">
    <PhArrowsOutLineVertical v-if="collapsed" /><PhArrowsInLineVertical v-else />
    <span class="@max-3xl:sr-only">{{ collapsed ? 'Expand all' : 'Collapse all' }}</span>
  </Button>
</template>
