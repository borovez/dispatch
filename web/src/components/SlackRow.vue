<script setup lang="ts">
import { ref } from 'vue'
import { PhPushPin } from '@phosphor-icons/vue'
import type { SlackItem } from '@shared/types'
import { useRowArming } from '@/composables/arming'
import { useDeck } from '@/stores/deck'
import { fullDate, timeAgo } from '@/utils/format'
import { KIND } from '@/utils/slack'
import { cn } from '@/lib/utils'
import SlackActions from './SlackActions.vue'
import ItemContextMenu from './ItemContextMenu.vue'
import { useSlackMenu } from '@/composables/itemMenus'
import JiraPill from './JiraPill.vue'
import SlackText from './SlackText.vue'
import { modClickHint, openInAppOr } from '@/lib/external'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

/** Slack inbox row; clicking it opens the message in the side panel. */
defineProps<{ item: SlackItem }>()
const deck = useDeck()
const slackMenu = useSlackMenu()
const rowEl = ref<HTMLElement>()
useRowArming(rowEl)
</script>

<template>
  <ItemContextMenu :entries="() => slackMenu(item)">
  <div
    ref="rowEl"
    :data-slack-id="item.id"
    :class="cn(
      'lazy-row group flex cursor-pointer flex-wrap items-start gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent sm:flex-nowrap',
      item.status !== 'new' && 'opacity-60',
      deck.selectedSlackId === item.id && 'bg-accent ring-2 ring-primary ring-inset',
    )"
    :title="item.permalink ? `Open in Dispatch · ${modClickHint(item.permalink)}` : undefined"
    @click="openInAppOr($event, item.permalink, () => (deck.selectedSlackId = item.id))"
  >
    <Avatar class="size-7 shrink-0">
      <AvatarImage v-if="item.userAvatar" :src="item.userAvatar" :alt="item.userName" />
      <AvatarFallback class="text-[10px]">{{ item.userName.slice(0, 2).toUpperCase() }}</AvatarFallback>
    </Avatar>
    <!-- Narrow screens: time and actions go on a line under the message -->
    <div class="min-w-0 flex-1 max-sm:basis-[calc(100%-2.5rem)]">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <PhPushPin v-if="item.pinned" :size="12" weight="fill" class="shrink-0 text-primary" aria-label="Pinned" />
        <span class="font-semibold">{{ item.userName }}</span>
        <span class="inline-flex items-center gap-1 text-muted-foreground">
          <component :is="KIND[item.kind].icon" :size="12" />{{ item.channelName }}
        </span>
        <Badge v-if="item.kind === 'saved'" variant="primary" class="h-4 text-[10px]">saved</Badge>
        <Badge v-if="item.kind === 'todo'" variant="primary" class="h-4 text-[10px]">todo</Badge>
        <Badge v-if="item.awaitingReply && item.status === 'new'" variant="warning" class="h-4 text-[10px]">awaiting reply</Badge>
        <Badge v-if="item.threadTs" variant="muted" class="h-4 text-[10px]">in thread</Badge>
        <JiraPill v-if="item.jiraKey" :issue-key="item.jiraKey" />
      </div>
      <SlackText :text="item.text" :rich="item.rich" class="mt-0.5 line-clamp-2 text-sm" />
    </div>
    <time
      :datetime="item.postedAt"
      :title="fullDate(item.postedAt)"
      class="w-16 shrink-0 pt-0.5 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums max-sm:ml-10 max-sm:w-auto max-sm:flex-1 max-sm:self-center max-sm:pt-0 max-sm:text-left"
    >
      {{ timeAgo(item.postedAt) }}
    </time>
    <SlackActions :item="item" class="opacity-60 transition-opacity group-hover:opacity-100" />
  </div>
  </ItemContextMenu>
</template>
