<script setup lang="ts">
import ExternalLink from '@/components/ExternalLink.vue'
import { computed } from 'vue'
import { PhFlag, PhWarning } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { useFlagPrs } from '@/composables/flags'
import PrListPopover from './PrListPopover.vue'

/** Feature flags (PR panel): state per environment, read only, with a link to LaunchDarkly, and the PRs that name each flag */
const props = defineProps<{ keys: string[] }>()
const deck = useDeck()
const connected = computed(() => !!deck.overview?.configured.launchdarkly)
const flagPrs = useFlagPrs()
/** A flag LaunchDarkly doesn't have (a typo, or not created yet) stands out amber; a failed lookup red */
const problemOf = (error?: string) => (!error ? null : /not found/i.test(error) ? 'missing' : 'error')
const rows = computed(() =>
  props.keys.map((k) => {
    const flag = deck.flagByKey.get(k)
    return { key: k, flag, prs: flagPrs(k), problem: problemOf(flag?.error) }
  }),
)
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="{ key, flag, prs, problem } in rows"
      :key="key"
      :class="
        cn(
          'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          problem === 'missing' && 'border-warning/50 bg-warning/10',
          problem === 'error' && 'border-destructive/50 bg-destructive/10',
        )
      "
    >
      <PhWarning v-if="problem" :size="15" weight="fill" :class="problem === 'missing' ? 'text-warning' : 'text-destructive'" />
      <PhFlag v-else :size="15" weight="fill" :class="flag?.envs[0] ? (flag.envs[0].on ? 'text-success' : 'text-muted-foreground') : 'text-muted-foreground'" />
      <ExternalLink v-if="flag" :href="flag.url" icon="always" :label="flag.name" class="font-mono">{{ key }}</ExternalLink>
      <span v-else class="font-mono">{{ key }}</span>
      <span v-if="flag && flag.name !== key" class="min-w-0 truncate text-xs text-muted-foreground">{{ flag.name }}</span>
      <Badge v-if="flag?.archived" variant="muted">archived</Badge>
      <Badge v-if="flag?.temporary" variant="outline" title="Marked temporary in LaunchDarkly: remove it once rolled out">temporary</Badge>
      <PrListPopover compact v-if="prs.length" :ids="prs" :placeholder="`Go to a PR using ${key}…`" />
      <span class="flex-1" />
      <template v-if="flag?.envs.length">
        <Badge
          v-for="e in flag.envs"
          :key="e.key"
          :variant="e.on ? 'success' : 'muted'"
          :title="e.lastModified ? `Changed ${timeAgo(e.lastModified)}` : undefined"
        >
          {{ e.key }} · {{ e.on ? 'on' : 'off' }}
        </Badge>
      </template>
      <Badge v-else-if="problem === 'missing'" variant="warning" :title="`${flag?.error}: a typo in the key, or not created yet`">Not in LaunchDarkly</Badge>
      <Badge v-else-if="problem === 'error'" variant="destructive" :title="flag?.error">Couldn't check</Badge>
      <span v-else class="text-xs text-muted-foreground">
        {{ connected ? 'Not synced yet' : 'Connect LaunchDarkly in Settings to see its state' }}
      </span>
    </div>
  </div>
</template>
