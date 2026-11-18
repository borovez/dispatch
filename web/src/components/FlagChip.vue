<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowSquareOut, PhFlag, PhWarning } from '@phosphor-icons/vue'
import { externalHint, siteName } from '@/lib/external'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import PrListPopover from './PrListPopover.vue'
import { useFlagPrs } from '@/composables/flags'

/**
 * One feature flag as a chip (release trains, release contents): green when on in the first
 * environment, amber when off, muted when unknown, an amber warning when LaunchDarkly doesn't have
 * it; a click opens LaunchDarkly. Hover card (laid out like the link hover card): name and key,
 * state per environment, the link.
 */
const props = defineProps<{ flagKey: string }>()
const deck = useDeck()
const flag = computed(() => deck.flagByKey.get(props.flagKey))
const flagPrs = useFlagPrs()
const prIds = computed(() => flagPrs(props.flagKey))
const on = computed(() => flag.value?.envs[0]?.on)
const missing = computed(() => !!flag.value?.error && /not found/i.test(flag.value.error))
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <HoverCard :open-delay="250" :close-delay="100">
      <HoverCardTrigger as-child>
        <!-- data-no-link-preview: this card replaces the link card for the LaunchDarkly link -->
        <a
          :href="flag?.url"
          target="_blank"
          rel="noopener"
          data-no-link-preview
          class="group/ext inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs"
          :class="
            missing ? 'bg-warning/12 text-warning ring-1 ring-warning/40' : on === true ? 'bg-success/12 text-success' : on === false ? 'bg-warning/12 text-warning' : 'bg-muted text-muted-foreground'
          "
          @click.stop
        >
          <PhWarning v-if="missing" :size="12" weight="fill" /><PhFlag v-else :size="12" weight="fill" />{{ flagKey
          }}<PhArrowSquareOut v-if="flag?.url" :size="11" class="-ml-0.5 opacity-0 transition-opacity group-hover/ext:opacity-100" />
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="start" class="w-80 p-3 text-xs" data-no-link-preview>
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <PhFlag class="size-3.5" />
          <span>LaunchDarkly · Feature flag</span>
          <span class="flex-1" />
          <Badge v-if="missing" variant="warning">Not in LaunchDarkly</Badge>
          <Badge v-else-if="flag?.temporary" variant="outline">temporary</Badge>
          <Badge v-if="flag?.archived" variant="muted">archived</Badge>
        </div>
        <p class="mt-1.5 text-sm leading-snug font-medium">{{ flag?.name && flag.name !== flagKey ? flag.name : flagKey }}</p>
        <p v-if="flag?.name && flag.name !== flagKey" class="font-mono text-muted-foreground">{{ flagKey }}</p>

        <div v-if="flag?.envs.length" class="mt-2 flex flex-wrap gap-1">
          <Badge v-for="e in flag.envs" :key="e.key" :variant="e.on ? 'success' : 'muted'" :title="e.lastModified ? `Changed ${timeAgo(e.lastModified)}` : undefined">
            {{ e.key }} · {{ e.on ? 'on' : 'off' }}
          </Badge>
        </div>
        <p v-else class="mt-1.5 text-muted-foreground">
          {{ missing ? `${flag?.error}: a typo in the key, or not created yet` : (flag?.error ?? (deck.overview?.configured.launchdarkly ? 'Not synced yet' : 'LaunchDarkly not connected')) }}
        </p>

        <div v-if="flag?.url" class="mt-2 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug break-all text-muted-foreground select-all">{{ flag.url }}</div>
        <p v-if="flag?.url" class="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground select-none" :title="externalHint(flag.url)">
          <PhArrowSquareOut class="size-3 shrink-0" /> Click opens {{ siteName(flag.url) }}
        </p>
      </HoverCardContent>
    </HoverCard>
    <PrListPopover v-if="prIds.length" compact :ids="prIds" :placeholder="`Go to a PR using ${flagKey}…`" />
  </span>
</template>
