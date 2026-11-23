<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import { PhCheck, PhCopy, PhArrowSquareOut, PhSidebarSimple, PhArrowBendDownRight, PhWarning } from '@phosphor-icons/vue'
import type { LinkPreview } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { describeLink, type LinkInfo } from '@/lib/linkInfo'
import { externalHint, modKey, siteName } from '@/lib/external'
import { writeClipboard } from '@/lib/clipboard'
import { prStatus, type StatusTone } from '@/composables/prStatus'
import { timeAgo } from '@/utils/format'
import { useOneHoverCard } from '@/composables/oneHoverCard'
import { linkCardTarget } from '@/lib/hoverTargets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * One hover card for every web link in the app (PR descriptions, Jira text, Slack messages, ExternalLink…):
 * hovering a link for a moment shows its full URL, what it is (from the URL and what Dispatch already
 * has: PR status, Jira status, Slack author, flag) and, loaded after, the title / description / image
 * from `GET /api/link-preview` (GitHub and Jira through their APIs, other sites from the page).
 * The pointer can move onto the card (copy, open in Dispatch). Opt out with `data-no-link-preview`.
 */
const deck = useDeck()

const anchor = shallowRef<HTMLAnchorElement | null>(null)
const href = ref('')
/** The link opens in Dispatch on a plain click (it says so with `data-opens-in-app`); Cmd/Ctrl-click goes out */
const inApp = ref(false)
const pos = reactive({ top: 0, left: 0, above: false })
const card = ref<HTMLElement | null>(null)
const open = ref(false)
const local = shallowRef<LinkInfo | null>(null)
const remote = shallowRef<LinkPreview | null>(null)
const loading = ref(false)
const copied = ref(false)

/** Server answers, per URL, for the session */
const answers = new Map<string, Promise<LinkPreview>>()
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let stashedTitle: string | null = null

const WIDTH = 360
/**
 * Only links that leave Dispatch: the written href is an absolute http(s) URL on another origin. In-app
 * links (sidebar, router links: relative hrefs that the browser resolves to this origin) never get a card.
 */
const isWebLink = (a: HTMLAnchorElement) => linkCardTarget(a) && !card.value?.contains(a)

function restoreTitle() {
  if (anchor.value && stashedTitle != null) anchor.value.setAttribute('title', stashedTitle)
  stashedTitle = null
}
function hide() {
  clearTimeout(showTimer)
  restoreTitle()
  open.value = false
  anchor.value = null
  one.release()
}
// One hover card at a time: another card opening closes this one, and this one opening closes theirs
const one = useOneHoverCard(() => open.value && hide())
const scheduleHide = () => {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, 180)
}
const keep = () => clearTimeout(hideTimer)

function place(a: HTMLElement) {
  const r = a.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  pos.left = Math.min(Math.max(8, r.left), vw - WIDTH - 8)
  pos.above = r.bottom + 260 > vh && r.top > vh - r.bottom
  pos.top = pos.above ? r.top - 6 : r.bottom + 6
}

async function show(a: HTMLAnchorElement) {
  anchor.value = a
  href.value = a.href
  inApp.value = a.dataset.opensInApp !== undefined
  // The card replaces the browser's own tooltip while it is open
  stashedTitle = a.getAttribute('title')
  if (stashedTitle != null) a.removeAttribute('title')
  local.value = describeLink(a.href, deck)
  remote.value = null
  copied.value = false
  place(a)
  open.value = true
  // A link inside another hover card's content is that card's child: leave the card open
  if (!a.closest('[data-slot=hover-card-content]')) one.claim()
  if (local.value.complete) return
  loading.value = true
  let p = answers.get(a.href)
  if (!p) {
    p = api.linkPreview(a.href).catch((e): LinkPreview => ({ url: a.href, source: 'none', error: (e as Error).message }))
    answers.set(a.href, p)
  }
  const url = a.href
  const res = await p
  if (href.value !== url) return
  remote.value = res
  loading.value = false
  await nextTick()
  if (anchor.value) place(anchor.value)
}

useEventListener(document, 'pointerover', (e: PointerEvent) => {
  if (e.pointerType === 'touch') return
  const t = e.target as Element | null
  if (card.value?.contains(t)) return keep()
  const a = t?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || !isWebLink(a)) return
  keep()
  if (a === anchor.value && open.value) return
  clearTimeout(showTimer)
  // Moving from one link to the next while a card is open swaps at once
  showTimer = setTimeout(() => (restoreTitle(), show(a)), open.value ? 120 : 450)
})
useEventListener(document, 'pointerout', (e: PointerEvent) => {
  const from = (e.target as Element | null)?.closest?.('a[href]')
  const to = e.relatedTarget as Node | null
  if (card.value?.contains(e.target as Node)) {
    if (!card.value.contains(to)) scheduleHide()
    return
  }
  if (!from || (to && from.contains(to))) return
  clearTimeout(showTimer)
  if (open.value) scheduleHide()
})
useEventListener(window, 'scroll', () => open.value && hide(), { capture: true, passive: true })
useEventListener(document, 'pointerdown', (e) => open.value && !card.value?.contains(e.target as Node) && hide())
useEventListener(document, 'keydown', (e: KeyboardEvent) => e.key === 'Escape' && open.value && hide())

const REMOTE_TONE: Record<string, StatusTone> = { open: 'success', merged: 'merged', closed: 'destructive', draft: 'muted', private: 'muted', public: 'muted' }
const badge = computed(() => {
  const l = local.value
  if (l?.pr) return prStatus(l.pr)
  if (l?.badge) return l.badge
  const st = remote.value?.state
  if (!st) return null
  return { tone: REMOTE_TONE[st] ?? (remote.value?.source === 'jira' ? 'info' : 'muted'), label: st[0]!.toUpperCase() + st.slice(1) }
})
const title = computed(() => local.value?.title ?? remote.value?.title)
const description = computed(() => remote.value?.description || null)
const facts = computed(() => {
  const f = [...(local.value?.facts ?? [])]
  const r = remote.value
  if (r?.author && !f.some((x) => x.includes(r.author!))) f.push(r.source === 'jira' ? r.author : `by ${r.author}`)
  if (r?.updatedAt) f.push(`updated ${timeAgo(r.updatedAt)}`)
  if (r?.contentType) f.push(r.contentType)
  return f
})
const flagEnvs = computed(() => local.value?.flag?.envs ?? [])
const site = computed(() => remote.value?.siteName || local.value?.site || '')

function openInApp() {
  const o = local.value?.open
  if (!o) return
  if (o.kind === 'pr') deck.selectedId = o.id
  else if (o.kind === 'jira') deck.selectedJiraKey = o.id
  else deck.selectedSlackId = o.id
  hide()
}
async function copyUrl() {
  try {
    await writeClipboard(href.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {}
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && local"
      ref="card"
      role="tooltip"
      class="fixed z-[60] w-(--card-w) max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
      :style="{ '--card-w': `${WIDTH}px`, left: `${pos.left}px`, top: `${pos.top}px`, transform: pos.above ? 'translateY(-100%)' : undefined }"
      @pointerenter="keep"
    >
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <img v-if="remote?.favicon" :src="remote.favicon" alt="" referrerpolicy="no-referrer" class="size-3.5 rounded-sm" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <component :is="local.icon" v-else class="size-3.5" />
        <span class="truncate">{{ site }}</span>
        <span class="shrink-0">· {{ local.kind }}</span>
        <span class="flex-1" />
        <Badge v-if="badge" :variant="badge.tone" class="shrink-0">{{ badge.label }}</Badge>
      </div>

      <p v-if="title" class="mt-1.5 line-clamp-2 text-sm leading-snug font-medium">{{ title }}</p>
      <Skeleton v-else-if="loading" class="mt-2 h-4 w-3/4" />

      <p v-if="facts.length" class="mt-1 truncate text-xs text-muted-foreground">{{ facts.join(' · ') }}</p>

      <div v-if="flagEnvs.length" class="mt-1.5 flex flex-wrap gap-1">
        <Badge v-for="env in flagEnvs" :key="env.key" :variant="env.on ? 'success' : 'muted'">{{ env.key }}: {{ env.on ? 'on' : 'off' }}</Badge>
      </div>

      <p v-if="description" class="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
      <template v-else-if="loading">
        <Skeleton class="mt-2 h-3 w-full" />
        <Skeleton class="mt-1 h-3 w-2/3" />
      </template>

      <img
        v-if="remote?.image"
        :src="remote.image"
        alt=""
        referrerpolicy="no-referrer"
        class="mt-2 max-h-36 w-full rounded-md border object-cover"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />

      <p v-if="remote?.error" class="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"><PhWarning class="shrink-0" /> {{ remote.error }}</p>

      <div class="mt-2 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug break-all text-muted-foreground select-all">
        {{ href }}
        <span v-if="remote?.finalUrl" class="mt-1 flex gap-1 text-foreground/70"><PhArrowBendDownRight class="mt-px shrink-0" />{{ remote.finalUrl }}</span>
      </div>

      <div class="mt-2 flex items-center gap-1 select-none">
        <span v-if="inApp" class="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground select-none"><PhSidebarSimple class="size-3 shrink-0" /><span class="truncate">Click opens Dispatch · {{ modKey }}-click {{ siteName(href) }}</span></span>
        <span v-else class="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground select-none" :title="externalHint(href)"><PhArrowSquareOut class="size-3 shrink-0" /><span class="truncate">Click opens {{ siteName(href) }}</span></span>
        <Button v-if="local.open && !inApp" variant="ghost" size="xs" class="h-6 text-xs" @click="openInApp"><PhSidebarSimple /> Open in Dispatch</Button>
        <Button variant="ghost" size="xs" class="h-6 text-xs" :class="copied && 'text-success'" @click="copyUrl">
          <PhCheck v-if="copied" /><PhCopy v-else /> {{ copied ? 'Copied' : 'Copy' }}
        </Button>
      </div>
    </div>
  </Teleport>
</template>
