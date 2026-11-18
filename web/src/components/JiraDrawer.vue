<script setup lang="ts">
import ShareMenu from '@/components/ShareMenu.vue'
import KindIcon from '@/components/KindIcon.vue'
import ExternalLink from '@/components/ExternalLink.vue'
import { computed, ref, watch } from 'vue'
import { PhArrowSquareOut, PhChatCircle, PhGraph, PhPencilSimple, PhRocketLaunch, PhArrowsClockwise, PhRobot } from '@phosphor-icons/vue'
import type { JiraIssueDetail, LinkedPrs } from '@shared/types'
import LinkedPrRow from './LinkedPrRow.vue'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useArrowNav } from '@/composables/prNav'
import { useReleaseNav } from '@/composables/releaseNav'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { jiraTone, timeAgo, fullDate, jiraIcon } from '@/utils/format'
import AdfView from './AdfView.vue'
import JiraLinks from './JiraLinks.vue'
import ItemContextMenu from './ItemContextMenu.vue'
import { useJiraMenu } from '@/composables/itemMenus'
import JiraTransition from './JiraTransition.vue'
import PrRow from './PrRow.vue'
import FlagList from './FlagList.vue'
import SidePanel from './SidePanel.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

/** Side panel for a Jira issue: details, linked PRs and issues, description and latest comments. */
const deck = useDeck()
const jiraMenu = useJiraMenu()
const key = computed(() => deck.selectedJiraKey)
const nav = useReleaseNav()
const releaseId = computed(() => (key.value ? nav.releaseForIssue(key.value) : null))
const issue = computed(() => (key.value ? (deck.jiraByKey.get(key.value) ?? null) : null))
/** The key shown, the issue's current key (when it moved) and older keys that moved to it */
const aliases = computed(() => {
  if (!key.value) return []
  const now = issue.value?.key ?? key.value
  const olds = Object.entries(deck.overview?.jiraMoved ?? {}).filter(([, n]) => n === now).map(([o]) => o)
  return [...new Set([key.value, now, ...olds])]
})
const prs = computed(() => (key.value ? deck.prs.filter((p) => p.jiraKeys.some((k) => aliases.value.includes(k))) : []))
/** This issue's PRs that depend on or block others: "Show dependencies" focuses the graph on them */
const depPrs = computed(() => prs.value.map((p) => p.id).filter(nav.hasDeps))
/** Flags named by this issue's PRs */
const flags = computed(() => [...new Set(prs.value.flatMap((p) => p.flags))])
const url = computed(() => issue.value?.url ?? (deck.overview?.jiraBaseUrl && key.value ? `${deck.overview.jiraBaseUrl}/browse/${key.value}` : undefined))
useArrowNav('jira', () => deck.selectedJiraKey, (k) => (deck.selectedJiraKey = k))

/** Description and comments, fetched once per issue for this page session */
const cache = new Map<string, Promise<JiraIssueDetail>>()
const detail = ref<JiraIssueDetail | null>(null)
const error = ref('')
async function loadDetail(k: string | null, force = false) {
  if (!force) detail.value = null
  error.value = ''
  if (!k || !deck.overview?.configured.jira) return
  if (force) cache.delete(k)
  if (!cache.has(k)) cache.set(k, api.jiraDetail(k))
  try {
    const d = await cache.get(k)!
    if (key.value === k) detail.value = d
  } catch (e) {
    cache.delete(k)
    if (key.value === k) error.value = (e as Error).message
  }
}
watch(key, (k) => loadDetail(k), { immediate: true })

/**
 * PRs naming the issue that Dispatch doesn't list from its own sync (older merged PRs, other people's,
 * untracked repos): GitHub search and Jira's development panel, once per issue for this page session.
 * Ones Dispatch has show as PR rows, the rest as links to GitHub.
 */
const linkedCache = new Map<string, Promise<LinkedPrs>>()
const linked = ref<LinkedPrs | null>(null)
const linkedLoading = ref(false)
async function loadLinked(k: string | null, force = false) {
  if (!force) linked.value = null
  if (!k) return
  if (force || !linkedCache.has(k)) linkedCache.set(k, api.jiraLinkedPrs(k, force))
  linkedLoading.value = true
  try {
    const v = await linkedCache.get(k)!
    if (key.value === k) linked.value = v
  } catch (e) {
    linkedCache.delete(k)
    if (key.value === k) linked.value = { prs: [], errors: [(e as Error).message], fetchedAt: '' }
  }
  if (key.value === k) linkedLoading.value = false
}
watch(key, (k) => loadLinked(k), { immediate: true })
const shownIds = computed(() => new Set(prs.value.map((p) => p.id)))
/** Found PRs not already listed: synced ones as rows, others as links */
const extraSynced = computed(() => (linked.value?.prs ?? []).filter((p) => !shownIds.value.has(p.id)).flatMap((p) => deck.byId.get(p.id) ?? []))
const extraLinks = computed(() => (linked.value?.prs ?? []).filter((p) => !shownIds.value.has(p.id) && !deck.byId.has(p.id)))

/** Reload: the issue's fields (into the cache, so it shows even when the sync didn't fetch it) and its description and comments */
const reloading = ref(false)
async function reload() {
  const k = key.value
  if (!k || reloading.value) return
  reloading.value = true
  await Promise.all([deck.mutate(() => api.jiraRefresh(k)), loadDetail(k, true), loadLinked(k, true)])
  reloading.value = false
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
const details = computed(() => {
  const i = issue.value
  if (!i) return []
  return [
    { label: 'Type', value: i.type },
    { label: 'Priority', value: i.priority ?? 'None' },
    { label: 'Parent', value: i.parent ? `${i.parent.key} · ${i.parent.summary}` : '—', open: i.parent?.key },
    { label: 'Fix version', value: i.fixVersions.join(', ') || '—' },
    { label: 'Labels', value: i.labels.join(', ') || '—' },
  ]
})
</script>

<template>
  <SidePanel :open="!!key" @close="deck.selectedJiraKey = null">
    <template v-if="key" #header>
      <div class="flex flex-wrap items-center gap-1.5">
        <img v-if="issue?.typeIconUrl" :src="jiraIcon(issue!.typeIconUrl!)" :title="issue.type" class="size-4" alt="" />
        <ExternalLink v-if="url" :href="url" icon="always" class="font-mono text-sm font-medium text-primary">{{ key }}</ExternalLink>
        <span v-else class="font-mono text-sm font-medium">{{ key }}</span>
        <!-- Moved in Jira (another project): the old key resolves to it -->
        <button
          v-if="issue && issue.key !== key"
          class="rounded-md bg-warning/12 px-1.5 py-0.5 text-xs text-warning hover:bg-warning/20"
          :title="`Jira moved ${key} to ${issue.key}; open it under its new key`"
          @click="deck.selectedJiraKey = issue.key"
        >
          moved to <span class="font-mono font-medium">{{ issue.key }}</span>
        </button>
        <Badge v-if="issue" :variant="jiraTone(issue.statusCategory)">{{ issue.status }}</Badge>
        <span class="flex-1" />
        <Button variant="outline" size="sm" class="h-7" title="Copy a prompt for an AI agent to implement this issue" @click="deck.agentPromptKey = key">
          <PhRobot /> Prompt
        </Button>
        <Button v-if="deck.overview?.configured.jira" variant="outline" size="sm" class="h-7" @click="deck.composer = { mode: 'edit', key: key! }">
          <PhPencilSimple /> Edit
        </Button>
      </div>
      <h2 class="mt-1.5 flex items-start gap-2 leading-snug font-semibold"><KindIcon kind="jira" /><span class="min-w-0 pt-0.5">{{ issue?.summary ?? 'Not loaded from Jira' }}</span></h2>
    </template>

    <ScrollArea v-if="key" class="min-h-0 flex-1">
      <div class="space-y-5 p-4">
        <div v-if="issue" class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <div class="text-xs text-muted-foreground">Assignee</div>
            <div v-if="issue.assignee" class="flex items-center gap-1.5">
              <Avatar class="size-5">
                <AvatarImage :src="issue.assignee.avatarUrl ?? ''" :alt="issue.assignee.displayName" />
                <AvatarFallback class="text-[9px]">{{ initials(issue.assignee.displayName) }}</AvatarFallback>
              </Avatar>
              {{ issue.assignee.displayName }}
            </div>
            <div v-else class="text-muted-foreground">Unassigned</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">Updated</div>
            <div :title="fullDate(issue.updated)">{{ timeAgo(issue.updated) }}</div>
          </div>
          <div v-for="d in details" :key="d.label" class="min-w-0">
            <div class="text-xs text-muted-foreground">{{ d.label }}</div>
            <ItemContextMenu v-if="d.open" :entries="() => jiraMenu(d.open!, deck.jiraByKey.get(d.open!) ?? null)">
            <button
              type="button"
              class="block max-w-full truncate text-left text-primary hover:underline"
              :title="`Open ${d.value}`"
              @click="deck.selectedJiraKey = d.open"
            >
              {{ d.value }}
            </button>
            </ItemContextMenu>
            <div v-else class="truncate" :title="d.value">{{ d.value }}</div>
          </div>
        </div>

        <section>
          <div class="mb-1.5 flex items-center gap-2">
            <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pull requests</h3>
            <span class="flex-1" />
            <Button v-if="depPrs.length" variant="link" size="xs" class="h-auto p-0 text-xs" @click="nav.openDependencies(depPrs)">
              <PhGraph /> Show dependencies
            </Button>
          </div>
          <div v-if="prs.length || extraSynced.length" class="-mx-3">
            <PrRow v-for="p in [...prs, ...extraSynced]" :key="p.id" :pr="p" compact :preview="false" />
          </div>
          <div v-if="extraLinks.length" class="-mx-3"><LinkedPrRow v-for="p in extraLinks" :key="p.id" :pr="p" /></div>
          <p v-if="linkedLoading && !linked" class="text-xs text-muted-foreground">Looking on GitHub and in Jira…</p>
          <p v-else-if="!prs.length && !extraSynced.length && !extraLinks.length" class="text-sm text-muted-foreground">No linked pull requests</p>
          <p v-if="linked?.errors.length" class="mt-1 text-xs text-muted-foreground" :title="linked.errors.join('\n')">
            Couldn't check {{ linked.errors.length === 1 ? 'one source' : `${linked.errors.length} sources` }} for more PRs (hover for details).
          </p>
        </section>

        <section v-if="flags.length">
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Feature flags</h3>
          <FlagList :keys="flags" />
        </section>

        <section v-if="issue?.links.length">
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Linked issues</h3>
          <JiraLinks :links="issue.links" />
        </section>

        <Separator />

        <section>
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Description</h3>
          <p v-if="!deck.overview?.configured.jira" class="text-sm text-muted-foreground">Connect Jira to see the description and comments.</p>
          <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
          <template v-else-if="detail">
            <AdfView v-if="detail.description?.content?.length" :doc="detail.description" />
            <p v-else class="text-sm text-muted-foreground">No description</p>
          </template>
          <div v-else class="space-y-2"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" /></div>
        </section>

        <section v-if="detail && detail.comments.length">
          <h3 class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <PhChatCircle :size="14" /> Comments
            <span class="font-normal normal-case">{{ detail.commentTotal > detail.comments.length ? `latest ${detail.comments.length} of ${detail.commentTotal}` : detail.comments.length }}</span>
          </h3>
          <div class="space-y-3">
            <div v-for="c in detail.comments" :key="c.id" class="flex gap-3 rounded-lg border p-3">
              <Avatar class="size-7 shrink-0">
                <AvatarImage :src="c.avatarUrl ?? ''" :alt="c.author" />
                <AvatarFallback class="text-[10px]">{{ initials(c.author) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0 flex-1">
                <div class="text-xs"><span class="font-semibold">{{ c.author }}</span> <span class="text-muted-foreground" :title="fullDate(c.created)">{{ timeAgo(c.created) }}</span></div>
                <AdfView :doc="c.body" class="[&>p:first-child]:mt-0.5" />
              </div>
            </div>
          </div>
          <ExternalLink v-if="detail.commentTotal > detail.comments.length && url" :href="url" icon="always" class="mt-2 text-xs text-primary">
            All {{ detail.commentTotal }} comments in Jira
          </ExternalLink>
        </section>
      </div>
    </ScrollArea>
    <!-- Pinned actions, like the Slack panel -->
    <!-- To the release that ships this issue; Jira beside this window -->
    <template v-if="key && (releaseId || url || deck.overview?.configured.jira)" #actions>
      <ShareMenu v-if="url" :url="url" :ref-label="key" :title="issue?.summary" what="issue" />
      <template v-if="releaseId">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Open on the Releases page" @click="nav.openReleases(releaseId!, deck.byId.get(releaseId!)?.flow === 'hotfix' ? 'hotfixes' : 'releases')"><PhRocketLaunch /></Button>
        </TooltipTrigger>
        <TooltipContent>Open the release that ships this issue</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Show in the release graph" @click="nav.openGraph(releaseId!, releaseId!.split('#')[0])"><PhGraph /></Button>
        </TooltipTrigger>
        <TooltipContent>Show in the release graph</TooltipContent>
      </Tooltip>
      </template>
      <Tooltip v-if="deck.overview?.configured.jira">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Reload from Jira" :disabled="reloading" @click="reload">
            <PhArrowsClockwise :class="{ 'animate-spin': reloading }" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload from Jira</TooltipContent>
      </Tooltip>
    </template>

    <template v-if="key && (issue || url)" #footer>
      <Button v-if="url" variant="outline" size="sm" as="a" :href="url" target="_blank" rel="noopener"><PhArrowSquareOut /> Open in Jira</Button>
      <span class="flex-1" />
      <JiraTransition v-if="issue" :issue-key="key" prominent />
    </template>
  </SidePanel>
</template>
