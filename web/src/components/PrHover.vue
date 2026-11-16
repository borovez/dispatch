<script setup lang="ts">
import type { PrView } from '@shared/types'
import PrPreview from './PrPreview.vue'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { modKey } from '@/lib/external'

/**
 * Wraps a PR row or card (default slot) with a hover preview: description start and changed files.
 * Loads on first open (shared cache). `disabled` renders the slot alone.
 */
withDefaults(defineProps<{ pr: PrView; side?: 'right' | 'bottom'; disabled?: boolean }>(), { side: 'right' })
</script>

<template>
  <slot v-if="disabled" />
  <HoverCard v-else :open-delay="600" :close-delay="100">
    <HoverCardTrigger as-child><slot /></HoverCardTrigger>
    <HoverCardContent :side="side" align="start" class="w-96">
      <PrPreview :pr="pr" />
      <p class="mt-3 border-t pt-2 text-[11px] text-muted-foreground">Click opens it here · {{ modKey }}-click opens GitHub ↗</p>
    </HoverCardContent>
  </HoverCard>
</template>
