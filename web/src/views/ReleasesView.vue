<script setup lang="ts">
import StickyToolbar from '@/components/StickyToolbar.vue'
import ExternalLink from '@/components/ExternalLink.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhArrowsClockwise, PhCheckCircle, PhGitBranch, PhGraph, PhListBullets, PhWarning } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { timeAgo } from '@/utils/format'
import { isUnreleased } from '@/utils/releaseFlow'
import SectionHeading from '@/components/SectionHeading.vue'
import GroupCard from '@/components/GroupCard.vue'
import PrRow from '@/components/PrRow.vue'
import RepoName from '@/components/RepoName.vue'
import ReleaseItems from '@/components/ReleaseItems.vue'
import ReleaseGraph from '@/components/ReleaseGraph.vue'
import TrainCard from '@/components/TrainCard.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import RepoSelect from '@/components/RepoSelect.vue'
import ExpandingSearch from '@/components/ExpandingSearch.vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Releases: what each release PR ships (dev → master, release/* → master), and merged work not in a release yet.
 * Hotfixes: PRs straight to the release branch, and whether they made it back into dev.
 */
const deck = useDeck()
const v = useLayout().view('releases', { sections: {} as Record<string, boolean>, tab: 'releases' as 'releases' | 'hotfixes' | 'trains', mode: 'list' as 'list' | 'graph', query: '', collapsed: {} as Record<string, boolean> })
// The graph used to be a fourth tab
if ((v.tab as string) === 'graph') (v.tab = 'releases'), (v.mode = 'graph')
const graph = computed(() => v.mode === 'graph')
/** One repo or all ('' / 'all'), shared with the graph (and set by "Show in the release graph") */
const repoState = useLayout().view('releaseGraph', { repo: '' as string })
/** Repos with releases, hotfixes, tags or unreleased work; counted by open releases and open hotfixes */
const repoOptions = computed(() => {
  const m = new Map<string, { key: string; repo: string; count: number }>()
  const add = (repo: string, open: boolean) => {
    const o = m.get(repo.toLowerCase()) ?? { key: repo.toLowerCase(), repo, count: 0 }
    o.count += Number(open)
    m.set(o.key, o)
  }
  for (const p of deck.prs) if ((p.flow === 'release' || p.flow === 'hotfix') && p.state !== 'CLOSED') add(p.repo, p.state === 'OPEN')
  for (const p of deck.prs) if (isUnreleased(p)) add(p.repo, false)
  for (const t of deck.overview?.tags ?? []) add(t.repo, false)
  return [...m.values()].sort((a, b) => a.repo.localeCompare(b.repo))
})
const repoKey = computed(() => (repoState.repo && repoState.repo !== 'all' && repoOptions.value.some((o) => o.key === repoState.repo) ? repoState.repo : ''))
const inRepo = (repo: string) => !repoKey.value || repo.toLowerCase() === repoKey.value

const matches = (p: PrView) => {
  if (!inRepo(p.repo)) return false
  const q = v.query.trim().toLowerCase()
  if (!q) return true
  const c = deck.releaseById.get(p.id)
  const hay = `${p.id} ${p.title} ${p.headRef} ${p.baseRef} ${p.jiraKeys.join(' ')} ${c?.jiraKeys.join(' ') ?? ''} ${c?.items.map((i) => `${i.id} ${i.title}`).join(' ') ?? ''}`
  return q.split(/\s+/).every((t) => hay.toLowerCase().includes(t))
}
const byRecent = (a: PrView, b: PrView) => (b.mergedAt ?? b.updatedAt).localeCompare(a.mergedAt ?? a.updatedAt)

const releases = computed(() => deck.prs.filter((p) => p.flow === 'release' && p.state !== 'CLOSED' && matches(p)).sort(byRecent))
const openReleases = computed(() => releases.value.filter((p) => p.state === 'OPEN'))
const mergedReleases = computed(() => releases.value.filter((p) => p.state === 'MERGED'))
/** Merged into dev but in no release PR yet, per repo */
/** Tags of tag-based repos (newest first per repo), filtered by the search */
const tags = computed(() => {
  const q = v.query.trim().toLowerCase()
  return (deck.overview?.tags ?? []).filter((t) => {
    if (!inRepo(t.repo)) return false
    if (!q) return true
    const hay = `${t.repo} ${t.tag} ${t.jiraKeys.join(' ')} ${t.items.map((i) => `${i.id} ${i.title}`).join(' ')}`.toLowerCase()
    return q.split(/\s+/).every((w) => hay.includes(w))
  })
})
/** The newest tag of each repo starts expanded */
const latestPerRepo = computed(() => {
  const seen = new Set<string>()
  return new Set(tags.value.filter((t) => !seen.has(t.repo) && seen.add(t.repo)).map((t) => t.prId))
})

const unreleased = computed(() => {
  const m = new Map<string, PrView[]>()
  for (const p of deck.prs.filter((p) => isUnreleased(p) && matches(p)).sort(byRecent)) m.set(p.repo, [...(m.get(p.repo) ?? []), p])
  return [...m].map(([repo, prs]) => ({ repo, prs }))
})

const hotfixes = computed(() => deck.prs.filter((p) => p.flow === 'hotfix' && p.state !== 'CLOSED' && matches(p)).sort(byRecent))
const needsBackmerge = computed(() => hotfixes.value.filter((p) => p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged))
const openHotfixes = computed(() => hotfixes.value.filter((p) => p.state === 'OPEN'))
const doneHotfixes = computed(() => hotfixes.value.filter((p) => p.state === 'MERGED' && !(p.backmerge && !p.backmerge.backmerged)))

/** Release trains, filtered by the search */
const trains = computed(() =>
  (deck.overview?.trains ?? []).filter((t) => {
    if (repoKey.value && !t.releases.some((id) => inRepo(deck.byId.get(id)?.repo ?? id.split('#')[0]))) return false
    const q = v.query.trim().toLowerCase()
    if (!q) return true
    const hay = `${t.releases.join(' ')} ${t.jiraKeys.join(' ')} ${t.releases.map((id) => deck.byId.get(id)?.title ?? '').join(' ')}`.toLowerCase()
    return q.split(/\s+/).every((w) => hay.includes(w))
  }),
)

/** Merged releases and finished hotfixes start collapsed */
const isCollapsed = (key: string, byDefault = false) => v.collapsed[key] ?? byDefault
/** A section's cards (key, collapsed by default), for its heading's collapse / expand button */
type SectionCards = { key: string; byDefault: boolean }[]
const sectionCollapsed = (cards: SectionCards) => cards.every((c) => isCollapsed(c.key, c.byDefault))
function toggleSection(cards: SectionCards) {
  const collapse = !sectionCollapsed(cards)
  for (const c of cards) v.collapsed[c.key] = collapse
}
const releaseCards = (prs: PrView[]): SectionCards => prs.map((r) => ({ key: r.id, byDefault: r.state === 'MERGED' }))
const tagCards = computed<SectionCards>(() => tags.value.map((t) => ({ key: t.prId, byDefault: !latestPerRepo.value.has(t.prId) })))
const unreleasedCards = computed<SectionCards>(() => unreleased.value.map((u) => ({ key: `unreleased:${u.repo}`, byDefault: false })))

// ?focus=<pr id>: expand that release (or hotfix) and scroll to it; the graph tab handles it itself
const route = useRoute()
const router = useRouter()
watch(
  () => route.query.focus,
  async (focus) => {
    if (typeof focus !== 'string' || !focus || graph.value) return
    v.query = ''
    if (v.tab === 'hotfixes') {
      // Open just the group the hotfix is in
      const p = deck.byId.get(focus)
      const group = p?.state === 'OPEN' ? 'hf:open' : p?.backmerge && !p.backmerge.backmerged ? 'hf:needs' : 'hf:done'
      v.collapsed[group] = false
    } else {
      v.collapsed[focus] = false
      // A merged PR not in a release yet sits in its repo's "not in a release" group
      const p = deck.byId.get(focus)
      if (p && isUnreleased(p)) v.collapsed[`unreleased:${p.repo}`] = false
    }
    await nextTick()
    const el = document.querySelector(`[data-release-id="${CSS.escape(focus)}"]`) ?? document.querySelector(`[data-pr-id="${CSS.escape(focus)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.classList.add('flash-focus')
    setTimeout(() => el?.classList.remove('flash-focus'), 1600)
    router.replace({ query: {} })
  },
  { immediate: true },
)

/** Release being re-read from GitHub (spinner on its button) */
const refreshing = ref<string | null>(null)
async function refresh(id: string) {
  refreshing.value = id
  await deck.mutate(() => api.refreshRelease(id), 'Release contents updated')
  refreshing.value = null
}
</script>

<template>
  <!-- Width cap on the children, not the page, so the scrollbar sits at the far right -->
  <!-- The graph fills the window; the other tabs scroll the page (native scrollbar, like Settings) -->
  <div class="flex flex-col gap-4" :class="graph && 'h-page'">
    <StickyToolbar>
      <!-- @container: buttons go icon-only when this row is narrow -->
      <div class="@container flex flex-wrap items-center gap-2">
        <Tabs v-model="v.tab">
          <TabsList>
            <TabsTrigger value="releases" :count="openReleases.length">Releases</TabsTrigger>
            <TabsTrigger value="hotfixes" :count="needsBackmerge.length + openHotfixes.length">Hotfixes</TabsTrigger>
            <TabsTrigger value="trains" :count="trains.length">Trains</TabsTrigger>
          </TabsList>
        </Tabs>
        <!-- One repo or all, for the list and the graph (the graph also shows what links to it) -->
        <RepoSelect v-if="repoOptions.length > 1" :model-value="repoKey || 'all'" :tabs="repoOptions" @update:model-value="(r) => (repoState.repo = r === 'all' ? '' : r)" />
        <span class="flex-1" />
        <ExpandingSearch v-if="!graph" v-model="v.query" placeholder="Search PRs, branches, Jira keys…" />
        <div id="releases-toolbar" class="flex items-center gap-2 empty:hidden" />
        <!-- List or graph, for whichever tab is picked -->
        <ToggleGroup :model-value="v.mode" type="single" variant="outline" size="sm" aria-label="List or graph" @update:model-value="(m) => m && (v.mode = m as 'list' | 'graph')">
          <ToggleGroupItem value="list" aria-label="List" title="List"><PhListBullets /></ToggleGroupItem>
          <ToggleGroupItem value="graph" aria-label="Graph" title="Graph"><PhGraph /></ToggleGroupItem>
        </ToggleGroup>
      </div>
    </StickyToolbar>

    <ReleaseGraph v-if="graph" :scope="v.tab" />
    <div v-else class="space-y-4">
        <template v-if="v.tab === 'releases'">
          <template v-for="sec in [{ label: 'Open releases', prs: openReleases }, { label: 'Merged releases', prs: mergedReleases }]" :key="sec.label">
          <SectionHeading
            v-if="sec.prs.length"
            v-model:hidden="v.sections[sec.label]"
            :label="sec.label"
            :count="sec.prs.length"
            cards-toggle
            :cards-collapsed="sectionCollapsed(releaseCards(sec.prs))"
            @toggle-cards="toggleSection(releaseCards(sec.prs))"
          />
          <GroupCard
            v-for="r in v.sections[sec.label] ? [] : sec.prs"
            :key="r.id"
            :data-release-id="r.id"
            label=""
            :count="deck.releaseById.get(r.id)?.items.length ?? 0"
            :collapsed="isCollapsed(r.id, r.state === 'MERGED')"
            @update:collapsed="(c: boolean) => (v.collapsed[r.id] = c)"
          >
            <template #label>
              <span class="flex min-w-0 items-center gap-2">
                <Badge :variant="r.state === 'OPEN' ? 'success' : 'merged'" class="shrink-0">{{ r.state === 'OPEN' ? 'Open' : `Merged ${timeAgo(r.mergedAt!)}` }}</Badge>
                <RepoName :id="r.id" class="max-w-64 font-mono text-xs" />
                <span class="flex shrink-0 items-center gap-1 font-mono text-xs font-normal text-muted-foreground"><PhGitBranch :size="12" />{{ r.headRef }} → {{ r.baseRef }}</span>
              </span>
            </template>
            <div class="space-y-2">
              <div class="flex items-center gap-2 rounded-md bg-muted/50">
                <PrRow :pr="r" compact class="min-w-0 flex-1" :hide="['contents']" />
                <Button variant="ghost" size="icon-sm" class="mr-1.5" :disabled="refreshing === r.id" :title="refreshing === r.id ? 'Reading the release from GitHub…' : 'Re-read the release from GitHub'" @click="refresh(r.id)">
                  <PhArrowsClockwise :class="{ 'animate-spin': refreshing === r.id }" />
                </Button>
              </div>
              <ReleaseItems v-if="deck.releaseById.get(r.id)" :contents="deck.releaseById.get(r.id)!" />
              <p v-else class="px-2.5 py-2 text-sm text-muted-foreground">Contents load on the next sync, or refresh now.</p>
            </div>
          </GroupCard>
          </template>

          <template v-if="tags.length">
            <SectionHeading v-model:hidden="v.sections.Tags" label="Tags" :count="tags.length" cards-toggle :cards-collapsed="sectionCollapsed(tagCards)" @toggle-cards="toggleSection(tagCards)" />
            <GroupCard
              v-for="t in v.sections.Tags ? [] : tags"
              :key="t.prId"
              label=""
              :count="t.items.length"
              :collapsed="isCollapsed(t.prId, !latestPerRepo.has(t.prId))"
              @update:collapsed="(c: boolean) => (v.collapsed[t.prId] = c)"
            >
              <template #label>
                <span class="flex min-w-0 items-center gap-2">
                  <Badge variant="success" class="shrink-0">{{ t.date ? `Tagged ${timeAgo(t.date)}` : 'Tag' }}</Badge>
                  <RepoName :repo="t.repo" class="max-w-64 font-mono text-xs" />
                  <ExternalLink :href="t.url" class="shrink-0 font-mono text-xs text-primary">{{ t.tag }}</ExternalLink>
                  <span v-if="t.previous" class="shrink-0 font-mono text-xs font-normal text-muted-foreground">since {{ t.previous }}</span>
                </span>
              </template>
              <ReleaseItems :contents="t" />
            </GroupCard>
          </template>

          <template v-if="unreleased.length">
            <SectionHeading
              v-model:hidden="v.sections.unreleased"
              label="Merged, not in a release yet"
              :count="unreleased.length"
              cards-toggle
              :cards-collapsed="sectionCollapsed(unreleasedCards)"
              @toggle-cards="toggleSection(unreleasedCards)"
            />
            <GroupCard
              v-for="u in v.sections.unreleased ? [] : unreleased"
              :key="u.repo"
              :label="u.repo"
              :count="u.prs.length"
              :collapsed="isCollapsed(`unreleased:${u.repo}`)"
              @update:collapsed="(c: boolean) => (v.collapsed[`unreleased:${u.repo}`] = c)"
            >
              <template #label><RepoName :repo="u.repo" class="font-mono text-xs" /></template>
              <div><PrRow v-for="p in u.prs" :key="p.id" :pr="p" compact /></div>
            </GroupCard>
          </template>
          <div v-if="!releases.length && !unreleased.length && !tags.length" class="py-16 text-center text-muted-foreground">
            No release PRs found. A release PR targets master/main from dev (or a release/* branch).
          </div>
        </template>

        <template v-else-if="v.tab === 'trains'">
          <TrainCard v-for="t in trains" :key="t.id" :train="t" />
          <div v-if="!trains.length" class="py-16 text-center text-muted-foreground">
            No release trains. Open releases in different repos form a train when a PR in one depends on a PR in another, or when
            they ship the same Jira issues.
          </div>
        </template>

        <template v-else>
          <GroupCard
            v-for="g in [
              { key: 'hf:needs', label: 'Merged, not back in dev yet', prs: needsBackmerge, collapsed: false },
              { key: 'hf:open', label: 'Open', prs: openHotfixes, collapsed: false },
              { key: 'hf:done', label: 'Merged and backmerged', prs: doneHotfixes, collapsed: true },
            ].filter((g) => g.prs.length)"
            :key="g.key"
            :label="g.label"
            :count="g.prs.length"
            :collapsed="isCollapsed(g.key, g.collapsed)"
            @update:collapsed="(c: boolean) => (v.collapsed[g.key] = c)"
          >
            <div>
              <div v-for="p in g.prs" :key="p.id">
                <PrRow :pr="p" />
                <div v-if="p.state === 'MERGED' && p.backmerge" class="flex items-center gap-1.5 px-2.5 pb-2 text-xs" :class="p.backmerge.backmerged ? 'text-success' : 'text-warning'">
                  <PhCheckCircle v-if="p.backmerge.backmerged" :size="14" weight="fill" />
                  <PhWarning v-else :size="14" weight="fill" />
                  <template v-if="p.backmerge.backmerged">In {{ p.backmerge.into }}</template>
                  <template v-else-if="p.backmerge.error">Couldn't check {{ p.backmerge.into }}: {{ p.backmerge.error }}</template>
                  <template v-else>
                    Not in {{ p.backmerge.into }} yet
                    <template v-if="p.backmergePr">
                      · backmerge
                      <button class="font-mono text-primary hover:underline" @click="deck.selectedId = p.backmergePr"><RepoName :id="p.backmergePr" /></button> is open
                    </template>
                    <template v-else> · merge {{ p.baseRef }} back into {{ p.backmerge.into }}</template>
                  </template>
                </div>
              </div>
            </div>
          </GroupCard>
          <div v-if="!hotfixes.length" class="py-16 text-center text-muted-foreground">
            No hotfixes. A hotfix targets master/main directly in a repo that releases from dev.
          </div>
        </template>
    </div>
  </div>
</template>
