<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  PhCaretDown,
  PhCircleNotch,
  PhCopy,
  PhDotsSixVertical,
  PhGitMerge,
  PhArrowCounterClockwise,
  PhGitBranch,
  PhInfo,
  PhLinkBreak,
  PhListChecks,
  PhLockSimple,
  PhPause,
  PhQuestion,
  PhRobot,
  PhCheckCircle,
  PhWarning,
  PhX,
  PhArrowSquareOut,
  PhDotsThree,
  PhGitPullRequest,
  PhMagicWand,
  PhPencilSimple,
  PhPlus,
  PhSidebarSimple,
  PhTrash,
} from '@phosphor-icons/vue'
import type { PlanItem, PlanRelease, ReleasePlan } from '@shared/types'
import { api } from '@/api'
import { writeClipboard } from '@/lib/clipboard'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { lastPanel, usePanelDock } from '@/composables/panelDock'
import { onEscape } from '@/composables/escape'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import PrNumberLink from './PrNumberLink.vue'
import PrHover from './PrHover.vue'
import ExternalLink from './ExternalLink.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import BranchPicker from './BranchPicker.vue'
import { prStatus } from '@/composables/prStatus'
import RefreshButton from './RefreshButton.vue'
import { useListResync } from '@/composables/listResync'

/**
 * Release planner: a left-hand panel (open across pages, beside the PR panel on the right) with one
 * repo's PRs merged into dev and not released (server/src/releasePlan.ts), in buckets: one per
 * release branch (cherry-pick into it, in order), "only with dev → master", Hold, To decide, and
 * what needs nothing. Drag a PR between buckets to choose where it goes, or within a bucket to set
 * the cherry-pick order (saved as my decisions with positions: PUT /releases/arrange); each card
 * also has a Move to… menu. Copy prompt hands the plan to Claude (MCP: release_plan, record_release_decision).
 */
const deck = useDeck()
const v = useLayout().view('release-planner', { width: 520, repo: '', detached: false })

const plans = ref<ReleasePlan[] | null>(null)
const error = ref('')
const loading = ref(false)
async function load() {
  loading.value = true
  error.value = ''
  try {
    plans.value = await api.releasePlans()
    // Asked for a repo (a Plan button) in other casing: use the plan's spelling
    v.repo = plans.value.find((p) => p.repo.toLowerCase() === v.repo.toLowerCase())?.repo ?? plans.value[0]?.repo ?? ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
watch(() => deck.plannerOpen, (o) => o && load(), { immediate: true })
// New data (a sync, a refresh): the plan may have changed
watch(() => deck.overview, () => deck.plannerOpen && !busy.value && load())

const plan = computed(() => plans.value?.find((p) => p.repo === v.repo) ?? null)
/** The repo's open release PRs and the PRs in its plan: what its refresh re-fetches */
const planIds = computed(() => (plan.value ? [...plan.value.releases.map((r) => r.id), ...plan.value.items.map((i) => i.prId)] : []))
const listResync = useListResync()
async function refresh(e: MouseEvent) {
  if (!e.shiftKey && planIds.value.length) await listResync.resync(planIds.value, e)
  else if (e.shiftKey) await listResync.resync([], e)
  await load()
}
const short = (repo: string) => repo.split('/')[1] ?? repo
/** A release PR as Dispatch has it (status, hover preview), and what it ships already */
const releasePr = (r: PlanRelease | null) => (r && r.mode !== 'planned' ? deck.byId.get(r.id) ?? null : null)
/** What a release branch already contains that isn't a card here (merged straight into it, picked earlier), as locked rows */
const alreadyIn = (b: { release: PlanRelease | null; items: PlanItem[] }) => {
  if (b.release?.mode !== 'branch') return []
  const shown = new Set(b.items.map((i) => i.prId))
  return (deck.releaseById.get(b.release.id)?.items ?? []).filter((i) => !shown.has(i.id)).map((i) => ({ ...i, number: Number(i.id.split('#')[1]) }))
}
/** "Already in it" lists that are open (closed by default when long) */
const shownAlready = ref(new Set<string>())
const alreadyOpen = (key: string, n: number) => (n <= 3) !== shownAlready.value.has(key)
function toggleAlready(key: string) {
  const next = new Set(shownAlready.value)
  if (!next.delete(key)) next.add(key)
  shownAlready.value = next
}
const STEPS = [
  'Drag each PR into a release, or Hold. New release ships some PRs on their own branch.',
  'Drag within a release to set the cherry-pick order.',
  'Copy the prompt for Claude (bottom): it does the picks in your checkout and asks before every push.',
]
/** What the plan asks for that isn't on GitHub yet: picks not made, releases not created */
const pending = computed(() => {
  const p = plan.value
  if (!p) return null
  const picks = p.items.filter((i) => i.outcome === 'pick').length
  const create = p.releases.filter((r) => r.mode === 'planned').length
  if (!picks && !create) return null
  const into = new Set(p.items.filter((i) => i.outcome === 'pick').map((i) => i.target)).size
  return [
    picks && `${picks} PR${picks === 1 ? '' : 's'} to cherry-pick${into > 1 ? ` into ${into} releases` : ''}`,
    create && `${create} release${create === 1 ? '' : 's'} to create`,
  ]
    .filter(Boolean)
    .join(', ')
})
const todo = (p: ReleasePlan) => p.counts.pick + p.counts.decide
/** Repo menu, when nothing is marked to pick or decide: how many PRs are merged and not released */
const unreleased = (p: ReleasePlan) => p.counts.shipping + p.counts.skipped + p.counts.held + p.counts.waiting
const placedLabel = (p: ReleasePlan) => (unreleased(p) ? `${unreleased(p)} unreleased` : 'all released')
const placedHint = (p: ReleasePlan) => (unreleased(p) ? `${unreleased(p)} PR(s) merged into ${p.integration} and not released yet` : `Nothing merged into ${p.integration} is waiting for a release`)

/** Buckets: drop targets, each with what it means as a decision */
interface Bucket {
  key: string
  /** The release behind it (menu: open, edit, open the PR…), if any */
  release: PlanRelease | null
  title: string
  sub: string
  tone: 'primary' | 'muted' | 'warning'
  decision: 'release' | 'hold' | 'skip' | null
  releaseId: string | null
  items: PlanItem[]
  ordered: boolean
}
const buckets = computed<Bucket[]>(() => {
  const p = plan.value
  if (!p) return []
  const includes = p.releases.find((r) => r.mode === 'includes')
  const out: Bucket[] = p.releases
    .filter((r) => r.mode !== 'includes')
    .map((r) => ({
      key: `release:${r.id}`,
      release: r,
      title: r.head,
      sub: r.mode === 'planned' ? `Planned, not on GitHub yet · cut from ${r.base}` : `Cherry-pick these into it, in this order`,
      tone: 'primary',
      decision: 'release',
      releaseId: r.id,
      items: p.items.filter((i) => (i.outcome === 'pick' || i.outcome === 'shipping') && i.target === r.id).sort((a, b) => Number(b.locked) - Number(a.locked) || a.order - b.order),
      ordered: true,
    }))
  if (includes)
    out.push({
      key: 'skip',
      release: includes,
      title: `${includes.head} → ${includes.base}`,
      sub: `Ships whatever is left in ${p.integration}; nothing to cherry-pick`,
      tone: 'muted',
      decision: 'skip',
      releaseId: null,
      items: p.items.filter((i) => i.outcome === 'skipped' || (i.outcome === 'shipping' && i.target === includes.id)),
      ordered: false,
    })
  const picking = p.releases.some((r) => r.mode !== 'includes')
  // No Hold while a dev → master release is open: it ships everything in dev, so nothing can be held back
  if (picking && !includes)
    out.push({ key: 'hold', release: null, title: 'Hold', sub: 'Not in any release for now', tone: 'muted', decision: 'hold', releaseId: null, items: p.items.filter((i) => i.outcome === 'held'), ordered: false })
  const undecided = p.items.filter((i) => i.outcome === 'decide')
  if (undecided.length || picking)
    out.push({ key: 'decide', release: null, title: 'To decide', sub: 'Drag each one into a release or Hold', tone: 'warning', decision: null, releaseId: null, items: undecided, ordered: false })
  return out
})
const waiting = computed(() => plan.value?.items.filter((i) => i.outcome === 'waiting') ?? [])

// ---- Releases: plan a separate one, open its PR, edit / delete; manage open release PRs
const form = ref<{ id: string | null; branch: string; base: string; title: string } | null>(null)
function newRelease() {
  const p = plan.value
  if (!p) return
  // Empty: the base picker fills in the repo's default branch (main / master) once it has the list
  const base = ''
  const day = new Date().toISOString().slice(0, 10)
  form.value = { id: null, branch: `release/${day}`, base, title: `release: ${short(p.repo)} ${day}` }
}
function editRelease(r: PlanRelease) {
  form.value = { id: r.id, branch: r.head, base: r.base, title: r.title }
}
async function saveRelease() {
  const f = form.value
  const p = plan.value
  if (!f || !p) return
  if (!f.base.trim()) return void toast.error('Pick the branch it is cut from')
  const ok = await deck.mutate(
    () => (f.id ? api.plannedUpdate({ id: f.id, branch: f.branch.trim(), base: f.base.trim(), title: f.title.trim() }) : api.plannedCreate({ repo: p.repo, branch: f.branch.trim(), base: f.base.trim(), title: f.title.trim() })),
    f.id ? 'Release updated' : 'Release planned: drag PRs into it',
  )
  if (ok) {
    form.value = null
    await load()
  }
}
/** What a reset would clear for the repo shown: my decisions (incl. order) and planned releases */
const resettable = computed(() => {
  const p = plan.value
  if (!p) return null
  const decisions = p.items.filter((i) => i.decision).length
  const planned = p.releases.filter((r) => r.mode === 'planned').length
  if (!decisions && !planned) return null
  const parts = [decisions && `your ${decisions === 1 ? 'decision' : `${decisions} decisions`} and order`, planned && `${planned === 1 ? 'the planned release' : `${planned} planned releases`} (not on GitHub yet)`]
  return parts.filter(Boolean).join(' and ')
})
async function resetPlan() {
  const repo = plan.value?.repo
  if (repo && (await deck.mutate(() => api.clearReleasePlan(repo), `Reset the plan for ${short(repo)}`))) await load()
}
async function deleteRelease(r: PlanRelease) {
  if (await deck.mutate(() => api.plannedDelete(r.id), `Removed ${r.head}; its PRs are undecided again`)) await load()
}
const opening = ref<string | null>(null)
async function openPr(r: PlanRelease) {
  opening.value = r.id
  try {
    let res: { number: number; url: string } | undefined
    if (await deck.mutate(async () => void (res = await api.plannedOpenPr(r.id)), `Opened release PR for ${r.head}`)) {
      await load()
      if (res) deck.selectedId = `${plan.value?.repo.toLowerCase()}#${res.number}`
    }
  } finally {
    opening.value = null
  }
}
const prUrl = (id: string) => deck.byId.get(id)?.url

// ---- Moving: drag and drop, or the card's Move to… menu
const busy = ref(false)
const dragId = ref<string | null>(null)
const over = ref<{ bucket: string; before: string | null } | null>(null)

async function move(id: string, to: Bucket, before: string | null) {
  if (busy.value) return
  busy.value = true
  try {
    let ok: boolean
    if (to.decision === null) ok = await deck.mutate(() => api.setReleaseDecision(id, null))
    else {
      // The bucket's movable PRs in their new order, the moved one placed before `before` (or last)
      const ids = to.items.filter((i) => !i.locked && i.prId !== id).map((i) => i.prId)
      const at = before ? ids.indexOf(before) : -1
      ids.splice(at < 0 ? ids.length : at, 0, id)
      ok = await deck.mutate(() => api.arrangeRelease(ids, to.decision!, to.releaseId))
    }
    if (ok) await load()
  } finally {
    busy.value = false
  }
}
/**
 * Where a PR can go: not To decide (Dispatch puts PRs there, it isn't a choice), and not back into the
 * unordered group it's already in (Hold, dev → master: nothing would change). Releases take reordering.
 */
function canDrop(prId: string | null, b: Bucket) {
  if (!prId || b.decision === null) return false
  return b.ordered || !b.items.some((i) => i.prId === prId)
}
function onDragStart(e: DragEvent, i: PlanItem) {
  dragId.value = i.prId
  e.dataTransfer!.setData('text/plain', i.prId)
  e.dataTransfer!.effectAllowed = 'move'
}
function onDragOver(e: DragEvent, b: Bucket, before: string | null) {
  if (!dragId.value) return
  // Not a place for it: no preventDefault, so the browser shows the no-drop cursor
  if (!canDrop(dragId.value, b)) return void (over.value = null)
  e.preventDefault()
  over.value = { bucket: b.key, before }
}
function onDrop(e: DragEvent, b: Bucket) {
  e.preventDefault()
  const id = dragId.value
  const before = over.value?.bucket === b.key ? over.value.before : null
  dragId.value = null
  over.value = null
  if (id && before !== id && canDrop(id, b)) void move(id, b, before)
}
function onDragEnd() {
  dragId.value = null
  over.value = null
}

// ---- Width (drag the right edge)
// Docked with the right panel when they meet (composables/panelDock.ts): the seam moves both
const dock = usePanelDock()
// Escape closes the planner when it was used last, or when it's the only panel open
onEscape(() => deck.plannerOpen && (lastPanel.value === 'planner' || !deck.currentPanel) && ((deck.plannerOpen = false), true))
watch(() => deck.plannerOpen, (o) => o && (lastPanel.value = 'planner'))
function startResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = dock.plannerW.value
  const onMove = (e: MouseEvent) => dock.setPlannerWidth(startW + e.clientX - startX)
  const onUp = () => (window.removeEventListener('mousemove', onMove), window.removeEventListener('mouseup', onUp))
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  ev.preventDefault()
}

const copying = ref(false)
async function copyPrompt() {
  if (!plan.value) return
  copying.value = true
  try {
    const { prompt } = await api.releasePrompt(plan.value.repo)
    await writeClipboard(prompt)
    toast.success('Copied!', { description: `Release plan prompt for ${short(plan.value.repo)}: paste it into Claude Code in that repo` })
  } catch (e) {
    toast.error(`Couldn't copy the prompt: ${(e as Error).message}`)
  } finally {
    copying.value = false
  }
}
const TONE = { primary: 'text-primary', muted: 'text-muted-foreground', warning: 'text-warning' } as const
</script>

<template>
  <Transition name="slide-left">
    <aside
      v-if="deck.plannerOpen"
      data-planner
      :class="cn('fixed inset-y-0 left-0 z-40 flex w-full max-w-full flex-col border-r bg-background sm:w-(--planner-w)', dock.snapped.value ? 'shadow-none' : 'shadow-2xl')"
      :style="{ '--planner-w': `${dock.plannerW.value}px` }"
      @pointerdown.capture="lastPanel = 'planner'"
      @focusin="lastPanel = 'planner'"
    >
      <div
        class="absolute inset-y-0 -right-1 z-30 w-2.5 cursor-col-resize transition-colors hover:bg-primary/30 max-sm:hidden"
        :title="dock.snapped.value ? 'Drag to move the edge between the panels' : 'Drag to resize · reach the right panel to dock them'"
        @mousedown="startResize"
      />
      <!-- Docked: a handle on the seam to detach (each panel keeps its own width again) -->
      <Button
        v-if="dock.snapped.value"
        variant="outline"
        size="icon-xs"
        class="absolute top-1/2 -right-3 z-40 -translate-y-1/2 rounded-full bg-background shadow-sm max-sm:hidden"
        aria-label="Detach the panels"
        title="Detach: each panel keeps its own width (drag one into the other to dock again)"
        @click="dock.detach()"
      >
        <PhLinkBreak />
      </Button>
      <!-- Top bar -->
      <div class="flex h-11 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
        <PhListChecks class="ml-1 size-4 text-primary" />
        <span class="text-sm font-semibold">Release planner</span>
        <!-- Repo: those with work first, with what's to do -->
        <DropdownMenu v-if="plans?.length">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" class="ml-1 h-7 gap-1 px-2 font-mono text-xs">{{ short(v.repo) }} <PhCaretDown /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-72">
            <DropdownMenuLabel class="text-xs text-muted-foreground">Repo</DropdownMenuLabel>
            <!-- Each repo says what's left in words (a bare check read as "selected"); the shown repo is tinted -->
            <DropdownMenuItem v-for="p in plans" :key="p.repo" :class="p.repo === plan?.repo && 'bg-primary/10 text-primary'" @select="v.repo = p.repo">
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ short(p.repo) }}</span>
              <Badge v-if="p.counts.decide" variant="warning">{{ p.counts.decide }} to decide</Badge>
              <Badge v-if="p.counts.pick" variant="primary">{{ p.counts.pick }} to pick</Badge>
              <!-- No to-decide / to-pick counts: just how many are unreleased -->
              <span v-if="!todo(p)" class="text-[11px] text-muted-foreground" :title="placedHint(p)">{{ placedLabel(p) }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span class="flex-1" />
        <!-- Same refresh as the lists: this repo's release PRs and the PRs in its plan from GitHub, then the plan again -->
        <RefreshButton
          :label="plan ? `Refresh ${short(plan.repo)}'s releases and plan` : 'Refresh the plan'"
          full-sync
          :busy="loading || listResync.resyncing.value || deck.syncRunning"
          :refreshed-at="planIds.map((id) => deck.byId.get(id)?.fetchedAt)"
          @click="refresh"
        />
        <!-- Start over: my decisions, order and planned releases for this repo (nothing on GitHub changes) -->
        <ConfirmDialog
          v-if="resettable && plan"
          :title="`Reset the plan for ${short(plan.repo)}?`"
          :description="`This clears ${resettable}. Every PR goes back to where Dispatch would put it. Release PRs, branches and cherry-picks already done on GitHub stay as they are.`"
          confirm-label="Reset plan"
          @confirm="resetPlan"
        >
          <Button variant="ghost" size="icon-sm" aria-label="Reset the plan" title="Reset the plan: clear your decisions, order and planned releases"><PhArrowCounterClockwise /></Button>
        </ConfirmDialog>
        <Button variant="ghost" size="icon-sm" aria-label="Close the planner" title="Close" @click="deck.plannerOpen = false"><PhX /></Button>
      </div>

      <ScrollArea class="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div class="space-y-3 p-3 text-sm">
          <p v-if="error" class="text-destructive">{{ error }}</p>
          <div v-else-if="!plans" class="flex items-center gap-2 py-8 text-muted-foreground"><PhCircleNotch class="animate-spin" /> Working out the plan…</div>
          <p v-else-if="!plan" class="py-8 text-center text-muted-foreground">No repo integrates on a branch like dev.</p>
          <template v-else>
            <!-- Repo line; how it works sits behind the info icon -->
            <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="min-w-0 truncate"><span class="font-mono text-foreground">{{ plan.repo }}</span> · merged into {{ plan.integration }}, not released.</span>
              <HoverCard :open-delay="150" :close-delay="100">
                <HoverCardTrigger as-child>
                  <button type="button" class="shrink-0 rounded-sm text-muted-foreground hover:text-foreground" aria-label="How the planner works"><PhInfo class="size-4" /></button>
                </HoverCardTrigger>
                <HoverCardContent align="start" class="w-80 text-xs">
                  <p class="mb-2 font-medium">How it works</p>
                  <ol class="grid gap-1.5 text-muted-foreground">
                    <li v-for="(step, n) in STEPS" :key="n" class="flex items-start gap-2">
                      <span class="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground tabular-nums">{{ n + 1 }}</span>{{ step }}
                    </li>
                  </ol>
                </HoverCardContent>
              </HoverCard>
              <span class="flex-1" />
              <!-- Plans a separate release branch (opens the form below) -->
              <Button
                v-if="!form"
                variant="outline"
                size="sm"
                class="h-7 shrink-0 px-2 text-xs"
                title="Plan a release branch that ships some PRs on their own, by cherry-pick"
                @click="newRelease"
              >
                <PhPlus /> New release
              </Button>
            </p>
            <!-- A separate release: a branch off the base, filled by cherry-picks (Claude creates it from the prompt) -->
            <!-- The plan is only recorded here: say so while it asks for picks or releases GitHub doesn't have yet -->
            <Alert v-if="pending" variant="warning">
              <PhWarning />
              <AlertTitle class="text-xs">Not applied yet</AlertTitle>
              <AlertDescription class="text-xs">
                <p>{{ pending }}. Dispatch only records the plan: Copy prompt for Claude (bottom) applies it in your checkout.</p>
              </AlertDescription>
            </Alert>
            <p v-else-if="buckets.length" class="flex items-center gap-1.5 text-xs text-success"><PhCheckCircle /> Nothing to apply: GitHub matches the plan.</p>
            <form v-if="form" class="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3" @submit.prevent="saveRelease">
              <p class="flex items-center gap-1.5 text-xs font-medium"><PhGitBranch class="size-4 text-primary" />{{ form.id ? 'Edit the planned release' : 'New release' }}</p>
              <div class="grid grid-cols-[1fr_11rem] gap-2">
                <Input v-model="form.branch" class="h-8 font-mono text-xs" placeholder="release/plat-332" required />
                <BranchPicker v-model="form.base" :repo="plan.repo" default-on-load />
              </div>
              <Input v-model="form.title" class="h-8 text-xs" placeholder="release: …" required />
              <p class="text-[11px] text-muted-foreground">New branch name, then the branch it's cut from and merges into. Claude creates it from the prompt; once it's pushed you can open the PR from here.</p>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" @click="form = null">Cancel</Button>
                <Button size="sm" type="submit">{{ form.id ? 'Save' : 'Plan it' }}</Button>
              </div>
            </form>

            <!-- Buckets -->
            <section
              v-for="b in buckets"
              :key="b.key"
              :class="
                cn(
                  'rounded-lg border p-2 transition-[opacity,colors,filter]',
                  // While dragging: groups it can't go in grey out, the others get a faint outline, the one under the pointer lights up
                  dragId && !canDrop(dragId, b) && 'cursor-no-drop border-dashed opacity-40 grayscale',
                  // A release that doesn't exist yet (planned): dashed amber, so it doesn't read as a real one
                  b.release?.mode === 'planned' && 'border-dashed border-warning/60 bg-warning/5',
                  dragId && canDrop(dragId, b) && over?.bucket !== b.key && 'border-primary/30',
                  over?.bucket === b.key && 'border-primary bg-primary/5',
                )
              "
              @dragover="onDragOver($event, b, null)"
              @drop="onDrop($event, b)"
            >
              <header class="space-y-1 px-1 pb-1.5">
                <div class="flex items-center gap-1.5">
                  <PhQuestion v-if="b.tone === 'warning'" :class="cn('shrink-0', TONE[b.tone])" />
                  <PhPause v-else-if="b.key === 'hold'" :class="cn('shrink-0', TONE[b.tone])" />
                  <PhGitMerge v-else :class="cn('shrink-0', TONE[b.tone])" />
                  <!-- A release PR: its branch opens it in the panel (hover preview); planned ones have no PR yet -->
                  <PrHover v-if="releasePr(b.release)" :pr="releasePr(b.release)!" side="bottom">
                    <button type="button" :class="cn('min-w-0 truncate font-mono text-xs font-semibold hover:underline', TONE[b.tone])" :title="`Open #${b.release!.number} in the panel`" @click="deck.selectedId = b.release!.id">
                      {{ b.title }}
                    </button>
                  </PrHover>
                  <span v-else :class="cn('min-w-0 truncate text-xs font-semibold', b.release && 'font-mono', TONE[b.tone])">{{ b.title }}</span>
                  <span class="flex-1" />
                  <Badge v-if="b.release?.mode === 'planned'" variant="warning" title="Planned in Dispatch: the branch and PR don't exist yet">Not created yet</Badge>
                  <Badge v-else-if="releasePr(b.release)" :variant="prStatus(releasePr(b.release)).tone" class="max-w-40"><span class="truncate">{{ prStatus(releasePr(b.release)).label }}</span></Badge>
                  <Badge variant="count" :title="`${b.items.length} PR(s) in this group`">{{ b.items.length }}</Badge>
                <!-- The release itself: open / edit it, or for a planned one open its PR, edit, remove -->
                <DropdownMenu v-if="b.release">
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon-xs" class="text-muted-foreground" :aria-label="`Release ${b.release.head}`"><PhDotsThree /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-64">
                    <template v-if="b.release.mode === 'planned'">
                      <DropdownMenuItem :disabled="opening === b.release.id" @select="openPr(b.release)"><PhGitPullRequest /> Open the release PR (branch pushed)</DropdownMenuItem>
                      <DropdownMenuItem @select="editRelease(b.release)"><PhPencilSimple /> Edit branch / title…</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" @select="deleteRelease(b.release)"><PhTrash /> Remove this release</DropdownMenuItem>
                    </template>
                    <template v-else>
                      <DropdownMenuItem @select="deck.selectedId = b.release.id"><PhSidebarSimple /> Open #{{ b.release.number }}</DropdownMenuItem>
                      <DropdownMenuItem v-if="prUrl(b.release.id)" as-child>
                        <a :href="prUrl(b.release.id)" target="_blank" rel="noopener"><PhArrowSquareOut /> Open on GitHub</a>
                      </DropdownMenuItem>
                      <DropdownMenuItem @select="deck.prWriter = b.release.id"><PhMagicWand /> Edit title and description…</DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
                <!-- Where its PRs come from and land: dev ⟶ (cherry-pick) release branch ⟶ (merge) base; dev → master ships dev as is -->
                <p v-if="b.release" class="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-5 text-[11px] text-muted-foreground">
                  <template v-if="b.release.mode === 'includes'">
                    <code class="rounded bg-muted px-1 font-mono text-foreground">{{ plan.integration }}</code>
                    <span>merges into</span>
                    <code class="rounded bg-muted px-1 font-mono text-foreground">{{ b.release.base }}</code>
                    <span>via</span><PrNumberLink :id="b.release.id" :number="b.release.number" />
                  </template>
                  <template v-else>
                    <span>From</span>
                    <code class="rounded bg-muted px-1 font-mono text-foreground">{{ plan.integration }}</code>
                    <span>cherry-picked into</span>
                    <code class="rounded bg-muted px-1 font-mono text-foreground">{{ b.release.head }}</code>
                    <span>, then merges into</span>
                    <code class="rounded bg-muted px-1 font-mono text-foreground">{{ b.release.base }}</code>
                    <template v-if="b.release.mode !== 'planned'"><span>via</span><PrNumberLink :id="b.release.id" :number="b.release.number" /></template>
                  </template>
                </p>
                <p v-else class="pl-5 text-[11px] text-muted-foreground">{{ b.sub }}</p>
              </header>
              <div class="space-y-1">
                <div
                  v-for="(i, n) in b.items"
                  :key="i.prId"
                  :draggable="!i.locked && !busy"
                  :class="
                    cn(
                      'group/card flex items-start gap-1.5 rounded-md border bg-card px-2 py-1.5',
                      i.prereqIssues.length && 'border-destructive/60 bg-destructive/10',
                      !i.locked && 'cursor-grab active:cursor-grabbing',
                      dragId === i.prId && 'opacity-40',
                      over?.bucket === b.key && over.before === i.prId && 'border-t-2 border-t-primary',
                    )
                  "
                  @dragstart="onDragStart($event, i)"
                  @dragend="onDragEnd"
                  @dragover.stop="onDragOver($event, b, i.prId)"
                >
                  <PhLockSimple v-if="i.locked" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" title="Already in this release's contents" />
                  <PhDotsSixVertical v-else class="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                  <span v-if="b.ordered && !i.locked" class="mt-px w-4 shrink-0 text-[11px] text-muted-foreground tabular-nums">{{ n + 1 - b.items.filter((x) => x.locked).length }}.</span>
                  <div class="min-w-0 flex-1">
                    <p class="line-clamp-2 leading-snug"><PrNumberLink :id="i.prId" :number="i.number" /> {{ i.title }}</p>
                    <p class="truncate text-[11px] text-muted-foreground">
                      {{ i.author }} · merged {{ timeAgo(i.mergedAt) }}<template v-if="i.jira.length"> · {{ i.jira.map((j) => j.key).join(', ') }}</template>
                      <template v-if="i.locked"> · already in this release</template>
                    </p>
                    <p v-if="i.question" class="mt-0.5 text-xs">{{ i.question }}</p>
                    <p v-for="r in i.reasons" :key="r" class="text-[11px] text-muted-foreground">· {{ r }}</p>
                    <p v-for="nt in i.notes" :key="nt" :class="cn('flex items-center gap-1 text-[11px]', /prerequisite #/.test(nt) ? 'text-destructive' : 'text-warning')"><PhWarning class="shrink-0" /> {{ nt }}</p>
                  </div>
                  <!-- Move to… (keyboard / precise) -->
                  <DropdownMenu v-if="!i.locked">
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon-xs" class="shrink-0 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label="Move to">
                        <PhCaretDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-64">
                      <DropdownMenuLabel class="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
                      <DropdownMenuItem v-for="t in buckets.filter((x) => x.key !== b.key && canDrop(i.prId, x))" :key="t.key" @select="move(i.prId, t, null)">{{ t.title }}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <!-- Empty: a dashed drop target, no text (it turns primary while a PR is dragged over) -->
                <div
                  v-if="!b.items.length"
                  :class="cn('flex h-9 items-center justify-center rounded-md border border-dashed text-muted-foreground/60', over?.bucket === b.key && 'border-primary text-primary')"
                  title="Drop a PR here"
                  aria-label="Drop a PR here"
                >
                  <PhPlus class="size-4" />
                </div>
                <!-- What the release branch already has (its contents), locked -->
                <template v-if="alreadyIn(b).length">
                  <button type="button" class="flex w-full items-center gap-1 px-1 pt-1 text-[11px] text-muted-foreground hover:text-foreground" @click="toggleAlready(b.key)">
                    <PhCaretDown :class="cn('size-3 transition-transform', !alreadyOpen(b.key, alreadyIn(b).length) && '-rotate-90')" />
                    Already in it · {{ alreadyIn(b).length }}
                  </button>
                  <template v-if="alreadyOpen(b.key, alreadyIn(b).length)">
                    <div v-for="c in alreadyIn(b)" :key="c.id" class="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs" :title="`Already in ${b.title}`">
                      <PhLockSimple class="size-3.5 shrink-0 text-muted-foreground" />
                      <PrNumberLink v-if="deck.byId.has(c.id)" :id="c.id" :number="c.number" />
                      <ExternalLink v-else :href="c.url" class="font-mono">#{{ c.number }}</ExternalLink>
                      <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ c.title }}</span>
                    </div>
                  </template>
                </template>
              </div>
            </section>

            <!-- No release open: nothing to arrange -->
            <section v-if="waiting.length" class="space-y-1 rounded-lg border p-2">
              <p class="px-1 pb-1 text-xs font-semibold text-muted-foreground">No release open yet</p>
              <p v-for="i in waiting" :key="i.prId" class="truncate px-1 text-xs"><PrNumberLink :id="i.prId" :number="i.number" /> {{ i.title }}</p>
            </section>
            <p v-if="!plan.items.length" class="text-muted-foreground">Nothing merged into {{ plan.integration }} is waiting for a release.</p>
          </template>
        </div>
      </ScrollArea>

      <div v-if="plan && todo(plan)" class="space-y-2 border-t p-3">
        <Alert variant="info">
          <PhInfo />
          <AlertDescription class="text-xs">
            Paste the prompt into Claude Code in your checkout of {{ short(plan.repo) }}: it cherry-picks in this order (with -x), asks before every push and about
            anything still to decide, and never force-pushes. With Dispatch's MCP it reads the plan and saves your answers itself.
          </AlertDescription>
        </Alert>
        <Button class="w-full" :disabled="copying" @click="copyPrompt">
          <PhCircleNotch v-if="copying" class="animate-spin" /><PhRobot v-else /> Copy prompt for Claude<PhCopy class="opacity-70" />
        </Button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.18s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
}
</style>
