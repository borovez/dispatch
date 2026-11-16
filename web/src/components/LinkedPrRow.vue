<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowSquareOut, PhGitMerge, PhGitPullRequest } from '@phosphor-icons/vue'
import type { LinkedPr } from '@shared/types'
import { externalHint } from '@/lib/external'
import { timeAgo } from '@/utils/format'
import RepoName from './RepoName.vue'

/** A PR Dispatch doesn't sync (found by GitHub search or Jira's development panel): one dense line linking to GitHub */
const props = defineProps<{ pr: LinkedPr }>()
const STATE = {
  OPEN: { icon: PhGitPullRequest, cls: 'text-success', label: 'Open' },
  MERGED: { icon: PhGitMerge, cls: 'text-merged', label: 'Merged' },
  CLOSED: { icon: PhGitPullRequest, cls: 'text-destructive', label: 'Closed' },
} as const
const state = computed(() => STATE[props.pr.state])
const found = computed(() => props.pr.sources.map((s) => (s === 'github' ? 'GitHub search' : "Jira's development panel")).join(' and '))
</script>

<template>
  <a
    :href="pr.url"
    target="_blank"
    rel="noopener"
    :title="`${state.label} · not synced by Dispatch (found by ${found}) · ${externalHint(pr.url)}`"
    class="group flex min-w-0 items-center gap-2 rounded-md px-3 py-1 text-[13px] leading-5 transition-colors hover:bg-accent"
  >
    <component :is="state.icon" :size="14" class="shrink-0" :class="state.cls" />
    <RepoName :repo="pr.repo" :suffix="`#${pr.number}`" class="max-w-[40%] shrink-0 font-mono text-[11px]" />
    <span class="min-w-0 flex-1 truncate">{{ pr.title }}</span>
    <span class="shrink-0 text-[11px] text-muted-foreground">{{ pr.author }}<template v-if="pr.updatedAt"> · {{ timeAgo(pr.updatedAt) }}</template></span>
    <PhArrowSquareOut :size="12" class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
  </a>
</template>
