<script setup lang="ts">
import type { PrView } from '@shared/types'
import PrPreview from './PrPreview.vue'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

/**
 * Wraps a PR row or card (default slot) with a hover preview: status, what it does, branch and size, Open / GitHub / Copy (`PrPreview`).
 * Loads on first open (shared cache). `disabled` renders the slot alone.
 */
withDefaults(defineProps<{ pr: PrView; side?: 'right' | 'bottom'; disabled?: boolean }>(), { side: 'right' })
</script>

<template>
  <slot v-if="disabled" />
  <HoverCard v-else :open-delay="600" :close-delay="100">
    <HoverCardTrigger as-child><slot /></HoverCardTrigger>
    <!-- Same size and padding as the link hover card -->
    <HoverCardContent :side="side" align="start" class="w-[360px] p-3" data-no-link-preview>
      <PrPreview :pr="pr" />
    </HoverCardContent>
  </HoverCard>
</template>
