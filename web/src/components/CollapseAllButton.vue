<script setup lang="ts">
import { PhArrowsInLineVertical, PhArrowsOutLineVertical } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Expand all / Collapse all for a page of collapsible groups: an icon button, the label in its tooltip */
defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="text-muted-foreground" :aria-label="collapsed ? 'Expand all' : 'Collapse all'" @click="emit('toggle')">
        <PhArrowsOutLineVertical v-if="collapsed" /><PhArrowsInLineVertical v-else />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ collapsed ? 'Expand all groups' : 'Collapse all groups' }}</TooltipContent>
  </Tooltip>
</template>
