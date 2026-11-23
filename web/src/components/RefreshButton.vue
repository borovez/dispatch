<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowsClockwise } from '@phosphor-icons/vue'
import { timeAgo } from '@/utils/format'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The one refresh button (page toolbars, side panels): a ghost icon button whose icon spins while
 * `busy`. Tooltip: a short label, when the items were last refreshed (`refreshedAt`: one time, or
 * one per item: the newest, and the oldest when they differ), and the Shift-click hint with
 * `fullSync`. The parent gets the click event and decides (useListResync handles Shift itself).
 */
const props = withDefaults(
  defineProps<{ busy?: boolean; disabled?: boolean; label: string; fullSync?: boolean; refreshedAt?: string | null | (string | null | undefined)[] }>(),
  { busy: false, disabled: false, fullSync: false, refreshedAt: undefined },
)
const emit = defineEmits<{ click: [e: MouseEvent] }>()

const when = computed(() => {
  const all = (Array.isArray(props.refreshedAt) ? props.refreshedAt : [props.refreshedAt]).filter((t): t is string => !!t).sort()
  if (!all.length) return props.refreshedAt === undefined ? null : 'Refresh time not recorded yet'
  const newest = timeAgo(all.at(-1)!)
  const oldest = timeAgo(all[0]!)
  const unknown = Array.isArray(props.refreshedAt) && all.length < props.refreshedAt.length
  return newest === oldest && !unknown ? `Last refreshed ${newest}` : unknown
    ? `Last refreshed ${newest} · some not refreshed yet`
    : `Last refreshed ${newest} · oldest ${oldest}`
})
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground"
        :aria-label="label"
        :disabled="busy || disabled"
        @click="(e: MouseEvent) => emit('click', e)"
      >
        <PhArrowsClockwise :class="busy && 'animate-spin'" />
      </Button>
    </TooltipTrigger>
    <!-- Lines stacked (the content is a row by default, which squeezed them into columns) -->
    <TooltipContent side="bottom" class="block max-w-80 space-y-1 px-3 py-2 leading-snug">
      <p class="font-medium">{{ busy ? 'Refreshing…' : label }}</p>
      <p v-if="when && !busy" class="opacity-70">{{ when }}</p>
      <p v-if="fullSync && !busy" class="opacity-70">Shift-click for a full sync</p>
    </TooltipContent>
  </Tooltip>
</template>
