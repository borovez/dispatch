<script setup lang="ts">
import { computed } from 'vue'
import { useDeck, type PanelRef } from '@/stores/deck'
import { describeLink } from '@/lib/linkInfo'
import { timeAgo } from '@/utils/format'
import { ITEM_KIND } from '@/utils/itemKinds'
import { Badge } from '@/components/ui/badge'
import PrPreview from './PrPreview.vue'

/**
 * Hover details for an item the side panel can show (the history menu): a PR gets the PR preview;
 * a Jira issue or Slack message the link hover card's layout from what Dispatch has.
 */
const props = defineProps<{ item: PanelRef; /** No buttons: a look-only preview (the history menu) */ previewOnly?: boolean }>()
const deck = useDeck()

const pr = computed(() => (props.item.kind === 'pr' ? deck.byId.get(props.item.id) ?? null : null))
const jira = computed(() => (props.item.kind === 'jira' ? deck.jiraByKey.get(props.item.id) ?? null : null))
const slack = computed(() => (props.item.kind === 'slack' ? deck.overview?.slack.find((s) => s.id === props.item.id) ?? null : null))
const url = computed(() => jira.value?.url ?? slack.value?.permalink ?? '')
const info = computed(() => (url.value ? describeLink(url.value, deck) : null))
const kind = computed(() => ITEM_KIND[props.item.kind])
</script>

<template>
  <PrPreview v-if="pr" :pr="pr" :actions="!previewOnly" />
  <div v-else class="text-xs">
    <div class="flex items-center gap-1.5 text-muted-foreground">
      <img v-if="jira?.typeIconUrl" :src="jira.typeIconUrl" alt="" class="size-3.5" />
      <component :is="kind.icon" v-else class="size-3.5" />
      <span class="truncate">{{ info?.site || kind.label }}</span>
      <span class="shrink-0">· {{ info?.kind ?? kind.label }}</span>
      <span class="flex-1" />
      <Badge v-if="info?.badge" :variant="info.badge.tone" class="shrink-0">{{ info.badge.label }}</Badge>
      <Badge v-else-if="slack" :variant="slack.status === 'new' ? 'primary' : 'muted'" class="shrink-0">{{ slack.status === 'new' ? 'To handle' : slack.status }}</Badge>
    </div>
    <p class="mt-1.5 line-clamp-3 text-sm leading-snug font-medium">{{ jira?.summary ?? info?.title ?? (slack ? slack.text : item.id) }}</p>
    <p class="mt-1 truncate text-muted-foreground">
      <template v-if="jira">{{ [jira.key, jira.type, jira.assignee?.displayName, `updated ${timeAgo(jira.updated)}`].filter(Boolean).join(' · ') }}</template>
      <template v-else-if="slack">{{ slack.userName }} · {{ slack.channelName }} · {{ timeAgo(slack.postedAt) }}</template>
      <template v-else>{{ item.id }}</template>
    </p>
    <div v-if="url" class="mt-2 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">{{ url }}</div>
  </div>
</template>
