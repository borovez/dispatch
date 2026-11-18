<script setup lang="ts">
import RefreshButton from '@/components/RefreshButton.vue'
import { prStatus } from '@/composables/prStatus'
import { externalHint } from '@/lib/external'
import ShareMenu from '@/components/ShareMenu.vue'
import ChecksChip from '@/components/ChecksChip.vue'
import KindIcon from '@/components/KindIcon.vue'
import ExternalLink from '@/components/ExternalLink.vue'
import { useArrowNav } from '@/composables/prNav'
import { useDependencies } from '@/composables/dependencies'
import { useReleaseNav } from '@/composables/releaseNav'
import { issueSeedFromPr, removeDependencyEntry, useJiraMenu, usePrMenu } from '@/composables/itemMenus'
import ItemContextMenu from './ItemContextMenu.vue'
import { loadPrDetail } from '@/composables/prDetail'
import { releaseStatus } from '@shared/release'
import SidePanel from './SidePanel.vue'
import { computed, ref, watch } from 'vue'
import { PhCircleDashed, PhArrowSquareOut, PhArrowsClockwise, PhCircleNotch, PhGraph, PhTrain, PhInfo, PhWarning, PhCheckCircle, PhGitBranch, PhPlus, PhPushPin, PhRocketLaunch, PhTrash, PhXCircle, PhNotePencil, PhPencilSimple, PhMagicWand, PhRobot, PhChatCircle, PhProhibit, PhArrowCounterClockwise, PhCheck } from '@phosphor-icons/vue'
import type { DepEdge, PrDetail } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { jiraCardTone, timeAgo, jiraIcon, actionTone } from '@/utils/format'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraTransition from './JiraTransition.vue'
import ThreadList from './ThreadList.vue'
import PrDescription from './PrDescription.vue'
import PrFiles from './PrFiles.vue'
import JiraLinks from './JiraLinks.vue'
import RepoName from './RepoName.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import SectionToggle from './SectionToggle.vue'
import ResizeHandle from './ResizeHandle.vue'
import { cn } from '@/lib/utils'
import ReleaseItems from './ReleaseItems.vue'
import FlagList from './FlagList.vue'
import TrainOrder from './TrainOrder.vue'
import DepAddForm from './DepAddForm.vue'
import { FLOW_LABEL } from '@/utils/releaseFlow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
/** The action's badge tone, where alerts have a matching one */
const alertTone = computed(() => {
  const t = pr.value ? actionTone(pr.value) : 'default'
  return t === 'destructive' || t === 'warning' || t === 'success' || t === 'info' ? t : 'default'
})
const dv = useLayout().view('drawer', {
  tab: 'details' as 'details' | 'contents' | 'description' | 'files' | 'conversations',
  // Last dependency type used in the add form
  depKind: 'merge' as 'merge' | 'release',
  // Collapsible footer sections
  depsOpen: true,
  noteOpen: true,
  // Footer section heights (px), set with their grab bars
  depsHeight: 0, // 0: fit the list, up to 35% of the window
  // Whole footer (px, 0 = default), set by dragging the line above it; the note fills what's left
  footerHeight: 0,
  // Footer height while the note is closed (px, 0 = fit): the Dependencies list fills it
  closedFooterHeight: 0,
})
/**
 * While the note is open the footer has a set height and the note fills it, so dragging the line
 * between the sections moves both ways under the pointer. Collapsed, the footer fits its content.
 */
const FOOTER_DEFAULT = 360
const footerHeight = computed({
  get: () => (dv.noteOpen ? dv.footerHeight || FOOTER_DEFAULT : dv.depsOpen ? dv.closedFooterHeight : undefined) as number,
  set: (h: number) => (dv.noteOpen ? (dv.footerHeight = h) : (dv.closedFooterHeight = h)),
})
/** Note closed and the footer sized from its top line: the Dependencies list takes all of it */
const depsFill = computed(() => !dv.noteOpen && !!footerHeight.value)
/** The note keeps at least this much room when the Dependencies list grows */
const NOTE_MIN = 150
/** How much the open note can still give up before it hits NOTE_MIN (dragging the lines above it stops there) */
const noteEditor = ref<{ $el: HTMLElement } | null>(null)
const noteSpare = () => Math.max(0, (noteEditor.value?.$el.offsetHeight ?? NOTE_MIN) - NOTE_MIN)
const footerMin = (h: number) => (noteEditor.value ? h - noteSpare() : 80)
const depsArea = ref<{ $el: HTMLElement } | null>(null)
const depsViewport = () => depsArea.value?.$el.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
useArrowNav('pr', () => deck.selectedId, (id) => (deck.selectedId = id))
const pr = computed(() => deck.selected)
const refreshing = ref(false)
async function refreshContents() {
  refreshing.value = true
  await deck.mutate(() => api.refreshRelease(pr.value!.id), 'Release contents updated')
  refreshing.value = false
}
/** Contents only exists for release PRs; others show Details instead */
const tab = computed(() => (dv.tab === 'contents' && pr.value?.flow !== 'release' ? 'details' : dv.tab))
const contents = computed(() => (pr.value ? deck.releaseById.get(pr.value.id) : undefined))
const ALERT_ICON = { default: PhInfo, info: PhInfo, success: PhCheckCircle, warning: PhWarning, destructive: PhXCircle } as const
/** The release train this release PR is part of, and its place in it */
/** The train this release PR is in */
const trainData = computed(() => (pr.value ? deck.overview?.trains.find((t) => t.releases.includes(pr.value!.id)) : undefined))
const train = computed(() => {
  const id = pr.value?.id
  const t = id ? deck.overview?.trains.find((t) => t.releases.includes(id)) : undefined
  if (!t || !id) return null
  return {
    step: t.releases.indexOf(id) + 1,
    ordered: t.links.some((l) => l.kind === 'order'),
    total: t.releases.length,
    next: t.next === id,
    after: t.links.filter((l) => l.kind === 'order' && l.to === id).map((l) => l.from),
    with: t.releases.filter((r) => r !== id && !t.links.some((l) => l.kind === 'order' && (l.from === r || l.to === r) && (l.from === id || l.to === id))),
  }
})
/** The release to show on the Releases page: this one (release / hotfix) or the release that ships it */
const releaseTarget = computed(() => (pr.value?.flow ? pr.value.id : pr.value?.shipsIn[0]?.id) ?? null)
const nav = useReleaseNav()
const goReleases = () => nav.openReleases(releaseTarget.value!, pr.value?.flow === 'hotfix' ? 'hotfixes' : 'releases')
const goGraph = () => nav.openGraph(pr.value!.id, pr.value!.repo)
const openTrains = () => nav.openTrains()
/** Banner: the next step, why, and where the release stands (merged PRs) */
const banner = computed(() => {
  const p = pr.value
  if (!p) return null
  const lines = p.action.detail ? [p.action.detail] : []
  // Conflicts behind a more pressing action (changes requested…) still show, once, here
  if (p.state === 'OPEN' && p.mergeable === 'CONFLICTING' && p.action.kind !== 'resolve_conflicts') lines.push(`Also conflicts with ${p.baseRef}`)
  // The exact tag (releasedIn, shown below) is more precise than "in the latest tag"
  // A hotfix waiting on its backmerge: that's the story; its release line only repeats where it was merged
  if (p.state === 'MERGED' && p.release && !p.releasedIn && p.action.kind !== 'backmerge') {
    const r = releaseStatus(p.release).long
    if (!lines.includes(r)) lines.push(r)
  }
  const c = contents.value
  if (p.flow === 'release')
    lines.push(c ? `${p.state === 'MERGED' ? 'Shipped' : 'Ships'} ${c.items.length} PR(s) and ${c.jiraKeys.length} Jira issue(s) from ${p.headRef} to ${p.baseRef}.` : `Release from ${p.headRef} to ${p.baseRef}; contents load on the next sync.`)
  const hasContext = lines.length || p.shipsIn.length || (p.backmerge && p.state === 'MERGED') || p.releasedIn || train.value
  if (!hasContext && (p.action.kind === 'none' || p.action.kind === 'done')) return null
  return { title: p.action.label, lines }
})
/** New Jira issue pre-filled from this PR: title without its Jira keys, and a link back */
function createIssueFromPr() {
  const p = pr.value
  if (!p) return
  deck.composer = issueSeedFromPr(p)
}
const jira = computed(() => (pr.value?.jiraKeys ?? []).map((k) => ({ key: k, issue: deck.jiraByKey.get(k) })))

// ---- Description / Files: loaded when one of those tabs is shown (cache shared with card previews)
const detail = ref<PrDetail | null>(null)
const detailFor = ref('')
const detailError = ref('')
watch(
  () => [pr.value?.id, pr.value?.updatedAt, dv.tab] as const,
  async ([id, updatedAt, tab]) => {
    if (!id || !updatedAt || (tab !== 'description' && tab !== 'files')) return
    const key = `${id}|${updatedAt}`
    if (detailFor.value === key && detail.value) return
    detail.value = null
    detailError.value = ''
    try {
      const d = await loadPrDetail({ id, updatedAt })
      if (pr.value?.id === id) ((detail.value = d), (detailFor.value = key))
    } catch (e) {
      if (pr.value?.id === id) detailError.value = (e as Error).message
    }
  },
  { immediate: true },
)
/**
 * Reviews as badges, one per person: approved (green check), changes requested (red x), commented
 * without a verdict (speech bubble), dismissed; requested and not given yet (dashed circle); asked
 * again after reviewing (circular arrows, tooltip says the last verdict).
 */
const REVIEW_STATE: Record<string, { tone: 'success' | 'destructive' | 'muted'; icon: unknown; label: string }> = {
  APPROVED: { tone: 'success', icon: PhCheckCircle, label: 'Approved' },
  CHANGES_REQUESTED: { tone: 'destructive', icon: PhXCircle, label: 'Changes requested' },
  COMMENTED: { tone: 'muted', icon: PhChatCircle, label: 'Commented, no approval yet' },
  DISMISSED: { tone: 'muted', icon: PhProhibit, label: 'Review dismissed' },
  PENDING: { tone: 'muted', icon: PhCircleDashed, label: 'Review in progress' },
}
const reviewBadges = computed(() => {
  const p = pr.value
  if (!p) return []
  const requested = new Map(p.requestedReviewers.map((r) => [r.login.toLowerCase(), r]))
  const out = p.reviews.map((r) => {
    const st = REVIEW_STATE[r.state] ?? REVIEW_STATE.COMMENTED
    const when = r.submittedAt ? ` ${timeAgo(r.submittedAt)}` : ''
    if (requested.has(r.login.toLowerCase()))
      return { key: r.login, login: r.login, tone: 'outline' as const, icon: PhArrowsClockwise, pending: true, title: `${r.login}: review requested again, not given yet (last: ${st.label.toLowerCase()}${when})` }
    return { key: r.login, login: r.login, tone: st.tone, icon: st.icon, pending: false, title: `${r.login}: ${st.label}${when}` }
  })
  const reviewed = new Set(p.reviews.map((r) => r.login.toLowerCase()))
  for (const r of p.requestedReviewers)
    if (!reviewed.has(r.login.toLowerCase()))
      out.push({ key: `rq${r.login}`, login: `${r.isTeam ? 'team/' : ''}${r.login}`, tone: 'outline' as const, icon: PhCircleDashed, pending: true, title: `Review requested from ${r.isTeam ? 'the team ' : ''}${r.login}, not given yet` })
  return out
})

/**
 * Re-read this PR from GitHub now (checks, reviews, description; contents for a release) and its Jira
 * issues from Jira (status, assignee, summary for the Jira section), without a full sync
 */
const resyncing = ref(false)
async function resync() {
  const id = pr.value?.id
  if (!id || resyncing.value) return
  const keys = deck.overview?.configured.jira ? pr.value!.jiraKeys : []
  resyncing.value = true
  await deck.mutate(() => Promise.all([api.resyncPr(id), ...keys.map((k) => api.jiraRefresh(k))]))
  resyncing.value = false
}

const note = ref('')
watch(pr, (p) => (note.value = p?.note ?? ''), { immediate: true })
const saveMeta = (pinned = pr.value!.pinned) => deck.mutate(() => api.setMeta(pr.value!.id, note.value, pinned))

/** A dependent already merged although this PR hasn't satisfied it yet (it went out of order) */
const jumpedAhead = (id: string) => deck.byId.get(id)?.state === 'MERGED'
/** Which dependency list has its inline add form open */
const adding = ref<'waitsFor' | 'waitedOn' | null>(null)
watch(() => pr.value?.id, () => (adding.value = null))
/** Prerequisites not yet merged/released */
const waiting = computed(() => pr.value?.dependsOn.filter((e) => !e.satisfied).length ?? 0)
const deps = useDependencies()
const removeDep = (e: DepEdge) => deps.remove(e)
// Right-click menus on the PRs and issues listed in the panel
const prMenu = usePrMenu()
const jiraMenu = useJiraMenu()
const depMenu = (id: string, e: DepEdge) => prMenu.byId(id, deps.canRemove(e) ? [removeDependencyEntry(e, removeDep, deps.busy.value)] : [])

</script>

<template>
  <SidePanel v-model:footer-height="footerHeight" :footer-min="footerMin" :open="!!pr" @close="deck.selectedId = null">
    <template v-if="pr" #header>
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge :variant="actionTone(pr)">{{ pr.action.label }}</Badge>
            <Badge variant="outline">{{ pr.state }}{{ pr.isDraft ? ' · draft' : '' }}</Badge>
            <Badge v-if="pr.flow" :variant="pr.flow === 'hotfix' ? 'warning' : pr.flow === 'release' ? 'merged' : 'muted'">{{ FLOW_LABEL[pr.flow] }}</Badge>
            <Badge v-for="r in pr.relations" :key="r" variant="muted">{{ r.replace('_', ' ') }}</Badge>
          </div>
          <h2 class="flex items-start gap-2 leading-snug font-semibold"><KindIcon kind="pr" /><span class="min-w-0 pt-0.5">{{ pr.title }}</span></h2>
          <ExternalLink :href="pr.url" icon="always" :label="pr.id" class="mt-1 flex font-mono text-sm text-primary">
            <RepoName :id="pr.id" no-title />
          </ExternalLink>
    </template>
    <template v-if="pr" #actions>
        <ShareMenu :url="pr.url" :ref-label="`${pr.repo}#${pr.number}`" :title="pr.title" what="pull request" />
        <template v-if="releaseTarget">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="Open on the Releases page" @click="goReleases"><PhRocketLaunch /></Button>
            </TooltipTrigger>
            <TooltipContent>{{ pr.flow ? 'Open on the Releases page' : 'Open the release that ships this' }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="Show in the release graph" @click="goGraph"><PhGraph /></Button>
            </TooltipTrigger>
            <TooltipContent>Show in the release graph</TooltipContent>
          </Tooltip>
        </template>
        <RefreshButton :label="`Refresh this PR${pr.jiraKeys.length && deck.overview?.configured.jira ? ' and its Jira issues' : ''}`" :refreshed-at="pr.fetchedAt ?? null" :busy="resyncing" @click="resync" />
        <Tooltip v-if="pr.state === 'OPEN'">
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Edit title and description" class="text-primary" @click="deck.prWriter = pr.id"><PhMagicWand weight="fill" /></Button>
          </TooltipTrigger>
          <TooltipContent>Edit title and description, with Claude</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="saveMeta(!pr.pinned)">
              <PhPushPin :weight="pr.pinned ? 'fill' : 'regular'" :class="{ 'text-primary': pr.pinned }" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pr.pinned ? 'Unpin' : 'Pin to top of lists' }}</TooltipContent>
        </Tooltip>
    </template>

      <Tabs v-if="pr" :model-value="tab" class="min-h-0 flex-1 gap-0" @update:model-value="(t) => (dv.tab = t as typeof dv.tab)">
        <div class="border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger v-if="pr.flow === 'release'" value="contents" :count="contents?.items.length ?? 0">Contents</TabsTrigger>
            <TabsTrigger value="description">Description</TabsTrigger>
            <TabsTrigger value="files" :count="pr.changedFiles">Files</TabsTrigger>
            <TabsTrigger value="conversations" :count="pr.threads.length">Conversations</TabsTrigger>
          </TabsList>
        </div>

      <TabsContent v-for="t in ['description', 'files'] as const" :key="t" :value="t" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="p-4">
            <p v-if="detailError" class="text-sm text-destructive">{{ detailError }}</p>
            <template v-else-if="detail">
              <PrDescription v-if="t === 'description'" :html="detail.bodyHTML" />
              <PrFiles v-else :key="pr.id" :files="detail.files" :truncated="detail.filesTruncated" :pr-url="pr.url" />
            </template>
            <div v-else class="space-y-2"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" /></div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="contents" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="space-y-3 p-4">
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span class="flex-1">
                <template v-if="contents">Ships {{ contents.items.length }} PR(s) and {{ contents.jiraKeys.length }} Jira issue(s) · checked {{ timeAgo(contents.fetchedAt) }}</template>
                <template v-else>Not read yet</template>
              </span>
              <Button variant="outline" size="sm" :disabled="refreshing" @click="refreshContents">
                <PhArrowsClockwise :class="{ 'animate-spin': refreshing }" /> {{ refreshing ? 'Refreshing…' : 'Refresh' }}
              </Button>
            </div>
            <ReleaseItems v-if="contents" :contents="contents" class="-mx-2.5" />
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="conversations" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="p-4">
            <ThreadList v-if="pr.threads.length" :threads="pr.threads" />
            <p v-else-if="pr.unresolvedThreads" class="py-10 text-center text-sm text-muted-foreground">
              {{ pr.unresolvedThreads }} unresolved conversation(s). Details load on the next sync.
            </p>
            <p v-else class="py-10 text-center text-sm text-muted-foreground">No unresolved conversations.</p>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="details" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <div class="space-y-5 p-4">
          <!-- Status: what this PR needs next, with release flow context -->
          <Alert v-if="banner" :variant="alertTone">
            <component :is="ALERT_ICON[alertTone]" />
            <AlertTitle>{{ banner.title }}</AlertTitle>
            <AlertDescription>
              <p v-for="l in banner.lines" :key="l">{{ l }}</p>
              <p v-if="pr.shipsIn.length" class="flex flex-wrap items-center gap-x-1.5">
                <PhRocketLaunch :size="14" class="self-center" />
                <template v-for="(s, i) in pr.shipsIn" :key="s.id">
                  <span>{{ i ? 'and' : s.state === 'OPEN' ? 'Ships in' : 'Shipped via' }}</span>
                  <ItemContextMenu as="span" :entries="() => prMenu.byId(s.id)"><button class="font-mono text-primary hover:underline" @click="deck.selectedId = s.id"><RepoName :id="s.id" /></button></ItemContextMenu>
                  <span v-if="i === 0 && s.state === 'OPEN'" class="text-muted-foreground">(open release)</span>
                </template>
              </p>
              <p v-if="train" class="flex flex-wrap items-center gap-x-1.5">
                <PhTrain :size="14" class="self-center" />
                <button class="hover:underline" @click="openTrains">{{ train.ordered ? `Release train: step ${train.step} of ${train.total}` : `Release train of ${train.total}` }}</button>
                <Badge v-if="train.next" variant="primary" class="h-4 px-1.5 text-[10px]">Ship next</Badge>
                <template v-if="train.after.length">
                  · after
                  <ItemContextMenu v-for="a in train.after" :key="a" as="span" :entries="() => prMenu.byId(a)"><button class="font-mono text-primary hover:underline" @click="deck.selectedId = a"><RepoName :id="a" /></button></ItemContextMenu>
                </template>
                <template v-if="train.with.length">
                  · with
                  <ItemContextMenu v-for="w in train.with" :key="w" as="span" :entries="() => prMenu.byId(w)"><button class="font-mono text-primary hover:underline" @click="deck.selectedId = w"><RepoName :id="w" /></button></ItemContextMenu>
                </template>
              </p>
              <p v-if="pr.releasedIn" class="flex items-center gap-1.5">
                <PhRocketLaunch :size="14" />Released in
                <ExternalLink :href="pr.releasedIn.url" class="font-mono text-primary">{{ pr.releasedIn.tag }}</ExternalLink>
              </p>
              <p v-if="pr.backmerge && pr.state === 'MERGED' && (pr.backmerge.backmerged || pr.backmergePr)">
                <template v-if="pr.backmerge.backmerged">Back in {{ pr.backmerge.into }}.</template>
                <template v-else-if="pr.backmergePr">
                  Backmerge <ItemContextMenu as="span" :entries="() => prMenu.byId(pr?.backmergePr ?? '')"><button class="font-mono text-primary hover:underline" @click="deck.selectedId = pr.backmergePr"><RepoName :id="pr.backmergePr" /></button></ItemContextMenu> is open.
                </template>
              </p>
            </AlertDescription>
            <AlertAction v-if="(pr.flow === 'release' && dv.tab !== 'contents') || pr.markedDone || (pr.action.kind !== 'done' && pr.action.kind !== 'none')" class="flex flex-wrap justify-end gap-2">
              <Button v-if="pr.flow === 'release' && dv.tab !== 'contents'" size="sm" variant="outline" @click="dv.tab = 'contents'">View contents ({{ contents?.items.length ?? 0 }})</Button>
              <!-- Dismiss what it asks for (asks to confirm), or undo that -->
              <Button v-if="pr.markedDone" size="sm" variant="outline" :title="`Show “${pr.markedDone.label}” again`" @click="deck.mutate(() => api.setDone(pr!.id, null), `${pr!.markedDone!.label} again`)">
                <PhArrowCounterClockwise /> Undo done
              </Button>
              <Button v-else-if="pr.action.kind !== 'done' && pr.action.kind !== 'none'" size="sm" variant="outline" :title="`Not needed? Mark “${pr.action.label}” done`" @click="deck.markDonePr = pr.id">
                <PhCheck /> Mark as done
              </Button>
            </AlertAction>
          </Alert>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Branch</div>
              <div class="flex items-start gap-1 font-mono text-xs"><PhGitBranch :size="14" class="mt-px shrink-0" /><span class="min-w-0 break-all">{{ pr.headRef }} → {{ pr.baseRef }}</span></div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Author</div>
              <div>{{ pr.author.login }} · opened {{ timeAgo(pr.createdAt) }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Size</div>
              <div><span class="text-success">+{{ pr.additions }}</span> <span class="text-destructive">−{{ pr.deletions }}</span> · {{ pr.changedFiles }} files</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Checks</div>
              <ChecksChip :checks="pr.checks" :url="pr.url" class="mt-0.5" />
            </div>
          </div>

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Reviews</h3>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="r in reviewBadges" :key="r.key" :variant="r.tone" :class="r.pending && 'text-muted-foreground'" :title="r.title">
                <component :is="r.icon" />{{ r.login }}
              </Badge>
              <span v-if="!pr.reviews.length && !pr.requestedReviewers.length" class="text-sm text-muted-foreground">No reviews yet</span>
            </div>
            <button v-if="pr.unresolvedThreads" class="mt-1 text-xs text-warning hover:underline" @click="dv.tab = 'conversations'">
              {{ pr.unresolvedThreads }} unresolved conversation(s)
            </button>
          </section>

          <section v-if="trainData">
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Release train</h3>
            <TrainOrder :train="trainData" :release-id="pr.id" />
          </section>

          <section v-if="pr.flags.length">
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Feature flags</h3>
            <FlagList :keys="pr.flags" />
          </section>

          <Separator />

          <section>
            <div class="mb-1.5 flex items-center gap-2">
              <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Jira</h3>
              <span class="flex-1" />
              <Button v-if="deck.overview?.configured.jira" variant="ghost" size="sm" class="h-6 px-2 text-xs text-muted-foreground" @click="createIssueFromPr">
                <PhNotePencil /> Create issue
              </Button>
            </div>
            <div v-if="!jira.length" class="text-sm text-muted-foreground">No issue key found in title or branch.</div>
            <ItemContextMenu v-for="{ key, issue } in jira" :key="key" :entries="() => jiraMenu(key, issue ?? null, deck.prs.filter((p) => p.jiraKeys.includes(key)))">
            <!-- The card opens the issue in the panel; buttons and links inside keep their own actions -->
            <div
              :class="['mb-2 cursor-pointer rounded-lg border p-3 transition-colors hover:border-primary/60', issue && jiraCardTone(issue.statusCategory)]"
              role="button"
              tabindex="0"
              :aria-label="`Open ${key} in the panel`"
              @click="(e) => !(e.target as HTMLElement).closest('a, button, [role=combobox], [role=menuitem]') && (deck.selectedJiraKey = key)"
              @keydown.enter.self="deck.selectedJiraKey = key"
            >
              <template v-if="issue">
                <div class="flex items-center gap-2">
                  <img v-if="issue.typeIconUrl" :src="jiraIcon(issue.typeIconUrl!)" class="size-4" alt="" />
                  <span class="font-mono text-sm">{{ issue.key }}</span>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon-sm" class="text-muted-foreground" as="a" :href="issue.url" target="_blank" rel="noopener" :aria-label="`Open ${issue.key} in Jira`">
                        <PhArrowSquareOut />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ externalHint(issue.url) }}</TooltipContent>
                  </Tooltip>
                  <span class="flex-1" />
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-primary" :aria-label="`Prompt for an AI agent to implement ${issue.key}`" @click="deck.agentPromptKey = issue.key">
                        <PhRobot />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Prompt for an AI agent to implement {{ issue.key }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon-sm" class="text-muted-foreground" :aria-label="`Edit ${issue.key}`" @click="deck.composer = { mode: 'edit', key: issue.key }">
                        <PhPencilSimple />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit {{ issue.key }}</TooltipContent>
                  </Tooltip>
                  <JiraTransition :issue-key="issue.key" />
                </div>
                <div class="mt-1 text-sm">{{ issue.summary }}</div>
                <div class="mt-1 text-xs text-muted-foreground">
                  {{ issue.assignee?.displayName ?? 'Unassigned' }}<template v-if="issue.fixVersions.length"> · fix: {{ issue.fixVersions.join(', ') }}</template>
                </div>
<JiraLinks :links="issue.links" class="mt-2" />
              </template>
              <span v-else class="font-mono text-sm">{{ key }} <span class="text-muted-foreground">(not synced)</span></span>
            </div>
            </ItemContextMenu>
          </section>


        </div>
      </ScrollArea>
      </TabsContent>
      </Tabs>
    <!-- Always visible at the bottom, whichever tab is open -->
    <template v-if="pr" #footer>
      <div :class="cn('flex w-full flex-col gap-3', footerHeight && 'min-h-0 flex-1')">
        <section :class="depsFill ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'">
          <div class="flex items-center gap-2">
          <SectionToggle v-model:open="dv.depsOpen" label="Dependencies">
            <Badge variant="count">{{ pr.dependsOn.length + pr.dependents.length }}</Badge>
            <Badge v-if="waiting" variant="warning" class="h-4 px-1.5 text-[10px]">{{ waiting }} waiting</Badge>
          </SectionToggle>
          <span class="flex-1" />
          <Button v-if="pr.dependsOn.length + pr.dependents.length" variant="link" size="xs" class="h-auto p-0 text-xs" @click="nav.openDependencies([pr.id])">
            <PhGraph /> Show in graph
          </Button>
          </div>
          <ScrollArea
            v-show="dv.depsOpen"
            ref="depsArea"
            :class="cn('mt-2', depsFill ? 'min-h-0 flex-1' : dv.depsHeight ? '[&>[data-slot=scroll-area-viewport]]:h-(--deps-h)' : '[&>[data-slot=scroll-area-viewport]]:max-h-[35vh]')"
            :style="{ '--deps-h': `${dv.depsHeight}px` }"
          >
          <div class="pr-3">
            <div class="mb-1 flex items-center gap-2">
              <h4 class="text-xs text-muted-foreground">Waits for <span class="opacity-70">· these go first</span></h4>
              <span class="flex-1" />
              <Button v-if="adding !== 'waitsFor'" variant="ghost" size="xs" class="h-6 text-xs text-muted-foreground" title="Add a PR that must be merged or released before this one" @click="adding = 'waitsFor'"><PhPlus /> Add</Button>
            </div>
            <ul class="space-y-1">
              <ItemContextMenu v-for="e in pr.dependsOn" :key="e.to" :entries="() => depMenu(e.to, e)">
              <li class="flex items-center gap-2 text-sm">
                <PhCheckCircle v-if="e.satisfied" :size="16" weight="fill" class="shrink-0 text-success" />
                <PhXCircle v-else :size="16" class="shrink-0 text-warning" />
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.to"><RepoName :id="e.to" /></button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.to)?.title ?? (e.missing ? '(not synced yet)' : '') }}</span>
                <span class="flex-1" />
                <Badge :variant="prStatus(deck.byId.get(e.to)).tone" class="shrink-0">{{ prStatus(deck.byId.get(e.to)).label }}</Badge>
                <Badge
                  :variant="e.satisfied ? 'success' : 'outline'"
                  class="shrink-0"
                  :title="e.satisfied ? `No longer waiting: it is ${e.kind === 'release' ? 'released' : 'merged'}` : `This PR waits for it to be ${e.kind === 'release' ? 'released' : 'merged'}`"
                >{{ e.satisfied ? `${e.kind === 'release' ? 'released' : 'merged'} ✓` : `needs ${e.kind}` }}</Badge>
                <Badge variant="muted" :title="e.note ?? ''">{{ e.source }}</Badge>
                <Button v-if="deps.canRemove(e)" variant="ghost" size="icon-xs" :disabled="deps.busy.value" :title="e.id != null ? 'Remove' : 'Remove from the PR description'" @click="removeDep(e)"><PhCircleNotch v-if="deps.isPending(e.from, e.to)" class="animate-spin" /><PhTrash v-else /></Button>
              </li>
              </ItemContextMenu>
              <li v-if="!pr.dependsOn.length && adding !== 'waitsFor'" class="text-sm text-muted-foreground">None</li>
            </ul>
            <DepAddForm v-if="adding === 'waitsFor'" :key="pr.id" :pr="pr" side="waitsFor" @done="adding = null" />
            <div class="mt-3 mb-1 flex items-center gap-2">
              <h4 class="text-xs text-muted-foreground">Waiting on this PR <span class="opacity-70">· go after it</span></h4>
              <span class="flex-1" />
              <Button v-if="adding !== 'waitedOn'" variant="ghost" size="xs" class="h-6 text-xs text-muted-foreground" title="Add a PR that can only merge after this one" @click="adding = 'waitedOn'"><PhPlus /> Add</Button>
            </div>
            <ul class="space-y-1">
              <ItemContextMenu v-for="e in pr.dependents" :key="e.from" :entries="() => depMenu(e.from, e)">
              <li class="flex items-center gap-2 text-sm">
                <!-- Satisfied: this PR is merged / released, so the other one no longer waits on it -->
                <PhCheckCircle v-if="e.satisfied" :size="16" weight="fill" class="shrink-0 text-success" />
                <PhCircleDashed v-else :size="16" class="shrink-0 text-warning" />
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.from"><RepoName :id="e.from" /></button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.from)?.title }}</span>
                <span class="flex-1" />
                <Badge :variant="prStatus(deck.byId.get(e.from)).tone" class="shrink-0">{{ prStatus(deck.byId.get(e.from)).label }}</Badge>
                <Badge
                  :variant="e.satisfied ? 'success' : jumpedAhead(e.from) ? 'warning' : 'outline'"
                  class="shrink-0"
                  :title="e.satisfied ? `No longer waiting: this PR is ${e.kind === 'release' ? 'released' : 'merged'}` : jumpedAhead(e.from) ? `It was meant to wait for this PR to be ${e.kind === 'release' ? 'released' : 'merged'}, but it is already merged` : `Waits for this PR to be ${e.kind === 'release' ? 'released' : 'merged'}`"
                >{{ e.satisfied ? `${e.kind === 'release' ? 'released' : 'merged'} ✓` : jumpedAhead(e.from) ? 'merged first' : `waits for ${e.kind}` }}</Badge>
                <Button v-if="deps.canRemove(e)" variant="ghost" size="icon-xs" :disabled="deps.busy.value" :title="e.id != null ? 'Remove' : 'Remove from the PR description'" @click="removeDep(e)"><PhCircleNotch v-if="deps.isPending(e.from, e.to)" class="animate-spin" /><PhTrash v-else /></Button>
              </li>
              </ItemContextMenu>
              <li v-if="!pr.dependents.length && adding !== 'waitedOn'" class="text-sm text-muted-foreground">None</li>
            </ul>
            <DepAddForm v-if="adding === 'waitedOn'" :key="pr.id" :pr="pr" side="waitedOn" @done="adding = null" />

          </div>
          </ScrollArea>
          <ResizeHandle
            v-if="dv.depsOpen && dv.noteOpen"
            line
            :model-value="dv.depsHeight || 240"
            :min="48"
            :max-at="footerHeight ? (h: number) => h + noteSpare() : undefined"
            :reset="0"
            :target="depsViewport"
            class="relative z-10 -mx-3 -mt-1 -mb-3"
            @update:model-value="(h) => (dv.depsHeight = h)"
          />
        </section>
        <!-- Not draggable now (a section is closed), but the sections stay divided -->
        <div v-if="!(dv.depsOpen && dv.noteOpen)" class="-mx-3 h-px shrink-0 bg-border" aria-hidden="true" />
        <SectionToggle v-if="!dv.noteOpen" v-model:open="dv.noteOpen" label="My note">
          <span v-if="note.trim()" class="truncate text-xs text-muted-foreground normal-case">{{ note.trim().split('\n')[0] }}</span>
        </SectionToggle>
        <MarkdownEditor
          v-else
          ref="noteEditor"
          v-model="note"
          fill
          placeholder="Private note… (Markdown)"
          class="w-full"
          @blur="saveMeta()"
        >
          <template #label>
            <SectionToggle v-model:open="dv.noteOpen" label="My note" />
          </template>
        </MarkdownEditor>
      </div>
    </template>
  </SidePanel>
</template>

