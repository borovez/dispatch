<script setup lang="ts">
import { computed } from 'vue'
import { PhCheckCircle, PhCircle, PhCircleDashed, PhClock, PhQuestion, PhXCircle } from '@phosphor-icons/vue'
import type { BadgeVariants } from '@/components/ui/badge'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE, CHECK_STYLE, timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import ItemContextMenu from './ItemContextMenu.vue'
import RepoName from './RepoName.vue'
import { usePrMenu } from '@/composables/itemMenus'

/**
 * One step of a dependency chain (Overview): a chip colour coded by where the PR stands (done green,
 * merged and awaiting release blue, the next step primary, waiting amber, failing red, not synced
 * dashed) with a hover card that spells it out. Click opens the PR panel (or the not-synced panel).
 */
const props = defineProps<{ id: string; next: boolean; /** Position in the chain, 1-based */ step: number; of: number }>()
const deck = useDeck()
const prMenu = usePrMenu()
const pr = computed(() => deck.byId.get(props.id) ?? null)

type Tone = NonNullable<BadgeVariants['variant']>
const status = computed<{ tone: Tone; label: string; icon: unknown }>(() => {
  const p = pr.value
  if (!p) return { tone: 'muted', label: 'Not synced', icon: PhQuestion }
  if (p.state === 'CLOSED') return { tone: 'muted', label: 'Closed without merging', icon: PhXCircle }
  if (p.state === 'MERGED') {
    if (p.release && !p.release.released) return { tone: 'info', label: 'Merged, awaiting release', icon: PhClock }
    return { tone: 'success', label: p.release?.released ? 'Released' : 'Merged', icon: PhCheckCircle }
  }
  if (props.next) return { tone: 'primary', label: p.action.label, icon: PhCircle }
  return { tone: ACTION_TONE[p.action.kind], label: p.action.label, icon: PhCircleDashed }
})
/** Chip: tinted border and fill; the icon and label carry the colour */
const CHIP: Partial<Record<Tone, string>> = {
  success: 'border-success/40 bg-success/8',
  info: 'border-info/40 bg-info/8',
  primary: 'border-primary bg-primary/10',
  warning: 'border-warning/40 bg-warning/8',
  destructive: 'border-destructive/40 bg-destructive/8',
  merged: 'border-merged/40 bg-merged/8',
}
const TEXT: Partial<Record<Tone, string>> = {
  success: 'text-success',
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning',
  destructive: 'text-destructive',
  merged: 'text-merged',
}
const waitsFor = computed(() => (deck.overview?.edges ?? []).filter((e) => e.from === props.id))
const blocks = computed(() => (deck.overview?.edges ?? []).filter((e) => e.to === props.id))
const check = computed(() => (pr.value?.state === 'OPEN' ? CHECK_STYLE[pr.value.checks.state] : null))
</script>

<template>
  <ItemContextMenu as="span" :entries="() => prMenu.byId(id)">
    <HoverCard :open-delay="300" :close-delay="80">
      <HoverCardTrigger as-child>
        <button
          :data-pr-id="id"
          :class="cn(
            'flex max-w-full min-w-0 items-center gap-1 rounded-md border px-2 py-1 transition-colors hover:bg-accent',
            CHIP[status.tone] ?? (pr ? '' : 'border-dashed text-muted-foreground'),
            deck.selectedId === id && 'ring-2 ring-primary',
          )"
          @click="deck.selectedId = id"
        >
          <component :is="status.icon" :weight="status.tone === 'success' || next ? 'fill' : 'regular'" :class="cn('shrink-0', TEXT[status.tone] ?? 'text-muted-foreground')" />
          <RepoName :id="id" no-title class="max-w-56 min-w-0 font-mono" />
          <span :class="cn('max-w-40 shrink-0 truncate max-sm:hidden', TEXT[status.tone] ?? 'text-muted-foreground')">{{ status.label }}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" class="w-80 space-y-2 p-3 text-xs">
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <span>Step {{ step }} of {{ of }}</span>
          <span v-if="next" class="text-primary">· next to do</span>
        </div>
        <template v-if="pr">
          <p class="text-sm leading-snug font-medium">{{ pr.title }}</p>
          <div class="font-mono text-muted-foreground"><RepoName :id="id" /></div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge :variant="status.tone">{{ status.label }}</Badge>
            <Badge v-if="pr.state === 'OPEN' && pr.isDraft" variant="muted">Draft</Badge>
            <span v-if="check" :class="check.cls">{{ check.label }}</span>
          </div>
          <p v-if="pr.action.detail && pr.state === 'OPEN'" class="text-muted-foreground">{{ pr.action.detail }}</p>
          <p v-if="pr.state === 'MERGED'" class="text-muted-foreground">
            Merged {{ timeAgo(pr.mergedAt!) }}<template v-if="pr.release">
              · {{ pr.release.released ? `released (${pr.release.ref ?? 'checked'})` : `not in ${pr.release.ref ?? 'a release'} yet` }}</template>
          </p>
          <p v-else class="text-muted-foreground">{{ pr.author.login }} · updated {{ timeAgo(pr.updatedAt) }}</p>
        </template>
        <p v-else class="text-muted-foreground">Dispatch doesn't have this PR yet. Click to open it and sync it.</p>
        <div v-if="waitsFor.length || blocks.length" class="space-y-0.5 border-t pt-2">
          <p v-for="e in waitsFor" :key="`w${e.to}`" class="flex items-center gap-1">
            <component :is="e.satisfied ? PhCheckCircle : PhCircleDashed" :class="e.satisfied ? 'text-success' : 'text-warning'" class="shrink-0" />
            <span class="text-muted-foreground">Waits for</span>
            <RepoName :id="e.to" class="min-w-0 font-mono" />
            <span class="shrink-0 text-muted-foreground">{{ e.kind === 'release' ? 'released' : 'merged' }}</span>
          </p>
          <p v-for="e in blocks" :key="`b${e.from}`" class="flex items-center gap-1">
            <span class="ml-4 text-muted-foreground">Blocks</span>
            <RepoName :id="e.from" class="min-w-0 font-mono" />
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  </ItemContextMenu>
</template>
