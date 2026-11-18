<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhArrowRight, PhArrowSquareOut, PhCheck, PhCopy, PhGitBranch, PhGitPullRequest, PhSidebarSimple } from '@phosphor-icons/vue'
import type { PrDetail, PrView } from '@shared/types'
import { descriptionSummary, loadPrDetail } from '@/composables/prDetail'
import { prStatus } from '@/composables/prStatus'
import { useDeck } from '@/stores/deck'
import { externalHint, modKey, openExternal } from '@/lib/external'
import { writeClipboard } from '@/lib/clipboard'
import { timeAgo } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import RepoName from './RepoName.vue'

/**
 * Hover preview for a PR row or card, laid out like the link hover card (`LinkHoverCard`): site and
 * kind with the status, title, who / when, what it does (the description without its JIRA,
 * dependency and deployment sections), branch, size of the change with its biggest files, and
 * Open in Dispatch / GitHub / Copy.
 */
const props = defineProps<{ pr: PrView }>()
const deck = useDeck()
const detail = ref<PrDetail | null>(null)
const error = ref('')
onMounted(async () => {
  try {
    detail.value = await loadPrDetail(props.pr)
  } catch (e) {
    error.value = (e as Error).message
  }
})

const status = computed(() => prStatus(props.pr))
const summary = computed(() => (detail.value ? descriptionSummary(detail.value.bodyHTML) : ''))
/** The few files that changed most: they say more than the first ones alphabetically */
const biggest = computed(() =>
  [...(detail.value?.files ?? [])].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).slice(0, 3),
)
const total = computed(() => props.pr.additions + props.pr.deletions || 1)
const n = (x: number) => x.toLocaleString()

const copied = ref(false)
async function copy() {
  try {
    await writeClipboard(props.pr.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {}
}
</script>

<template>
  <div class="text-xs">
    <div class="flex items-center gap-1.5 text-muted-foreground">
      <PhGitPullRequest class="size-3.5 shrink-0" />
      <span class="truncate">GitHub</span>
      <span class="shrink-0">· Pull request</span>
      <span class="flex-1" />
      <Badge :variant="status.tone" class="shrink-0">{{ status.label }}</Badge>
    </div>

    <p class="mt-1.5 line-clamp-2 text-sm leading-snug font-medium">{{ pr.title }}</p>
    <p class="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground">
      <RepoName :id="pr.id" class="min-w-0 font-mono" />
      <span class="shrink-0 truncate">· by {{ pr.author.login }} · updated {{ timeAgo(pr.updatedAt) }}</span>
    </p>

    <p v-if="error" class="mt-1.5 text-destructive">{{ error }}</p>
    <template v-else-if="detail">
      <p v-if="summary" class="mt-1.5 line-clamp-3 leading-relaxed text-muted-foreground">{{ summary }}</p>
    </template>
    <template v-else>
      <Skeleton class="mt-2 h-3 w-full" />
      <Skeleton class="mt-1 h-3 w-2/3" />
    </template>

    <!-- Branch and size of the change, in the muted box the link card uses for the URL -->
    <div class="mt-2 space-y-1.5 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
      <p class="flex min-w-0 items-center gap-1" :title="`${pr.headRef} → ${pr.baseRef}`">
        <PhGitBranch class="shrink-0" />
        <span class="truncate">{{ pr.headRef }}</span>
        <PhArrowRight class="shrink-0" />
        <span class="shrink-0 text-foreground/80">{{ pr.baseRef }}</span>
      </p>
      <div class="flex items-center gap-2">
        <span class="text-foreground/80">{{ n(pr.changedFiles) }} {{ pr.changedFiles === 1 ? 'file' : 'files' }}</span>
        <span class="text-success tabular-nums">+{{ n(pr.additions) }}</span>
        <span class="text-destructive tabular-nums">−{{ n(pr.deletions) }}</span>
        <!-- Share of added vs removed lines -->
        <span class="ml-auto flex h-1.5 w-16 overflow-hidden rounded-full bg-background">
          <span class="bg-success" :style="{ width: `${(pr.additions / total) * 100}%` }" />
          <span class="bg-destructive" :style="{ width: `${(pr.deletions / total) * 100}%` }" />
        </span>
      </div>
      <ul v-if="biggest.length" class="space-y-0.5">
        <li v-for="f in biggest" :key="f.filename" class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-left [direction:rtl]" :title="f.filename"><bdi>{{ f.filename }}</bdi></span>
          <span class="text-success tabular-nums">+{{ f.additions }}</span>
          <span class="text-destructive tabular-nums">−{{ f.deletions }}</span>
        </li>
      </ul>
    </div>

    <div class="mt-2 flex items-center gap-1 select-none">
      <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{{ modKey }}-click opens GitHub</span>
      <Button variant="ghost" size="xs" class="h-6 text-xs" @click="deck.selectedId = pr.id"><PhSidebarSimple /> Open</Button>
      <Button variant="ghost" size="xs" class="h-6 text-xs" :title="externalHint(pr.url)" @click="openExternal(pr.url)"><PhArrowSquareOut /> GitHub</Button>
      <Button variant="ghost" size="xs" class="h-6 text-xs" :class="copied && 'text-success'" @click="copy">
        <PhCheck v-if="copied" /><PhCopy v-else /> {{ copied ? 'Copied' : 'Copy' }}
      </Button>
    </div>
  </div>
</template>
