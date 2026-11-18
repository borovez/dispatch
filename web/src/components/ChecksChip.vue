<script setup lang="ts">
import { computed } from 'vue'
import { PhCheckCircle, PhCircleNotch, PhMinusCircle, PhXCircle } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import ExternalLink from './ExternalLink.vue'

/**
 * A PR's checks as one chip (like the "N PRs" chip): coloured by state with the counts ("2 of 60
 * failing", "60 passing"). Clicking opens the failing checks, each linking to its run (scrolls when
 * long), and the PR's checks page on GitHub.
 */
const props = defineProps<{ checks: PrView['checks']; url: string }>()

const failing = computed(() => props.checks.failing)
const n = computed(() => props.checks.total)
const look = computed(() => {
  const s = props.checks.state
  if (failing.value.length || s === 'FAILURE' || s === 'ERROR')
    return { icon: PhXCircle, tone: 'text-destructive', border: 'border-destructive/40 bg-destructive/8', text: failing.value.length ? `${failing.value.length} of ${n.value} failing` : 'Failing' }
  if (s === 'PENDING' || s === 'EXPECTED') return { icon: PhCircleNotch, tone: 'text-warning', border: 'border-warning/40 bg-warning/8', text: n.value ? `Running · ${n.value} checks` : 'Running' }
  if (s === 'SUCCESS') return { icon: PhCheckCircle, tone: 'text-success', border: 'border-success/40 bg-success/8', text: `${n.value} passing` }
  return { icon: PhMinusCircle, tone: 'text-muted-foreground', border: '', text: 'No checks' }
})
const checksUrl = computed(() => `${props.url.replace(/\/$/, '')}/checks`)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full border bg-background px-2 text-xs font-medium hover:bg-accent data-[state=open]:bg-accent', look.border)"
        :title="`Checks: ${look.text}`"
      >
        <component :is="look.icon" :size="13" :weight="look.icon === PhCircleNotch ? 'bold' : 'fill'" :class="cn(look.tone, look.icon === PhCircleNotch && 'animate-spin')" />
        <span :class="look.tone">{{ look.text }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 gap-0 p-0" @open-auto-focus.prevent>
      <div class="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium">
        <component :is="look.icon" :size="13" weight="fill" :class="look.tone" />
        <span v-if="failing.length">{{ failing.length }} failing {{ failing.length === 1 ? 'check' : 'checks' }}<span class="font-normal text-muted-foreground"> of {{ n }}</span></span>
        <span v-else>{{ look.text }}</span>
      </div>
      <ScrollArea v-if="failing.length" class="[&>[data-slot=scroll-area-viewport]]:max-h-64">
        <ul class="p-1">
          <li v-for="f in failing" :key="f.name">
            <ExternalLink :href="f.url" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:no-underline">
              <PhXCircle :size="14" weight="fill" class="shrink-0 text-destructive" />
              <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
            </ExternalLink>
          </li>
        </ul>
      </ScrollArea>
      <p v-else class="px-3 py-2 text-xs text-muted-foreground">
        {{ checks.state === 'SUCCESS' ? 'Every check passes.' : checks.state === 'NONE' ? 'This PR has no checks.' : 'Nothing has failed so far.' }}
      </p>
      <div class="border-t px-3 py-2 text-xs">
        <ExternalLink :href="checksUrl" icon="always" class="text-muted-foreground hover:text-foreground">All checks on GitHub</ExternalLink>
      </div>
    </PopoverContent>
  </Popover>
</template>
