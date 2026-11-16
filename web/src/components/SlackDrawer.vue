<script setup lang="ts">
import KindIcon from '@/components/KindIcon.vue'
import ExternalLink from '@/components/ExternalLink.vue'
import { externalHint } from '@/lib/external'
import { computed, nextTick, ref, watch } from 'vue'
import { PhCaretRight, PhLink, PhArrowBendUpLeft, PhArrowDown, PhArrowsClockwise, PhArrowSquareOut, PhArrowUp, PhCircleNotch, PhGraph, PhRobot, PhRocketLaunch } from '@phosphor-icons/vue'
import type { SlackContext, SlackMessage } from '@shared/types'
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { useArrowNav } from '@/composables/prNav'
import { useReleaseNav } from '@/composables/releaseNav'
import { copySlackPrompt, copyText } from '@/composables/itemMenus'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import SidePanel from './SidePanel.vue'
import SlackText from './SlackText.vue'
import SlackActions from './SlackActions.vue'
import SlackUserCard from './SlackUserCard.vue'
import SlackReplyBox from './SlackReplyBox.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { KIND } from '@/utils/slack'

/** Side panel for a Slack inbox item: the message with the two before and after it. */
const deck = useDeck()
/** Reply box height (0: grows with the text), kept between messages */
const sv = useLayout().view('slack-panel', { replyHeight: 0 })
const item = computed(() => deck.selectedSlack)
/** The release the message is about: a linked PR's release, else a mentioned Jira issue's */
const nav = useReleaseNav()
const releaseId = computed(() => (item.value ? nav.releaseForText(`${item.value.rich ?? ''} ${item.value.text}`, item.value.jiraKey ? [item.value.jiraKey] : []) : null))
const isHotfix = computed(() => (releaseId.value ? deck.byId.get(releaseId.value)?.flow === 'hotfix' : false))
useArrowNav('slack', () => deck.selectedSlackId, (id) => (deck.selectedSlackId = id))

/** Messages around the item; "Load more" widens the window by STEP on either side */
const STEP = 5
const ctx = ref<SlackContext | null>(null)
const counts = ref({ before: 2, after: 2 })
const loading = ref<'' | 'before' | 'after'>('')
const error = ref('')
/** Fetched once per item and window for this page session */
const cache = new Map<string, Promise<SlackContext>>()

/** The list element; its scroll container is the ScrollArea viewport around it */
const list = ref<HTMLElement | null>(null)
const viewport = () => list.value?.closest<HTMLElement>('[data-slot=scroll-area-viewport]') ?? null

async function load(id: string, opts: { reveal?: boolean } = {}) {
  const { before, after } = counts.value
  const key = `${id}|${before}|${after}`
  if (!cache.has(key)) cache.set(key, api.slackAround(id, before, after))
  try {
    const c = await cache.get(key)!
    if (item.value?.id !== id) return
    ctx.value = c
    if (opts.reveal) {
      await nextTick()
      list.value?.querySelector('[data-target]')?.scrollIntoView({ block: 'center' })
    }
  } catch (e) {
    cache.delete(key)
    if (item.value?.id === id) error.value = (e as Error).message
  }
}
watch(
  () => item.value?.id,
  (id) => {
    ctx.value = null
    error.value = ''
    threads.value = {}
    counts.value = { before: 2, after: 2 }
    closeReply()
    if (id) load(id, { reveal: true })
  },
  { immediate: true },
)
/** Keeps what's shown while the wider window loads */
async function more(side: 'before' | 'after') {
  if (!item.value || loading.value) return
  loading.value = side
  counts.value = { ...counts.value, [side]: counts.value[side] + STEP }
  // Messages added above would push the view down: keep the reader where they were
  const vp = viewport()
  const fromBottom = vp ? vp.scrollHeight - vp.scrollTop : 0
  await load(item.value.id)
  if (side === 'before' && vp) {
    await nextTick()
    vp.scrollTop = vp.scrollHeight - fromBottom
  }
  loading.value = ''
}

/** Fetches the loaded window again from Slack (new replies, edits) */
const resyncing = ref(false)
async function resync() {
  const id = item.value?.id
  if (!id || resyncing.value) return
  resyncing.value = true
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}|`)) cache.delete(k)
  error.value = ''
  await load(id)
  resyncing.value = false
}

/**
 * Reply box. With a message picked, the reply goes into that message's thread (in a thread view: the
 * thread); without one, into the thread being shown, else straight into the channel or DM.
 */
const replying = ref(false)
const replyTo = ref<SlackMessage | null>(null)
const draft = ref('')
const sending = ref(false)
const box = ref<InstanceType<typeof SlackReplyBox> | null>(null)
/** People in the loaded conversation, for @mentions */
const people = computed(() => [...new Map((ctx.value?.messages ?? []).filter((m) => m.user).map((m) => [m.user, { id: m.user, name: m.userName }])).values()])
const replyThread = computed(() => item.value?.threadTs ?? replyTo.value?.ts ?? null)
const replyLabel = computed(() => {
  const i = item.value
  if (!i) return ''
  if (replyTo.value) return i.threadTs ? `Reply in the thread to ${replyTo.value.userName}` : `Reply in the thread of ${replyTo.value.userName}'s message`
  return i.threadTs ? 'Reply in the thread' : `Message ${i.channelName === 'DM' ? i.userName : i.channelName}`
})
async function startReply(m: SlackMessage | null = null) {
  replyTo.value = m
  replying.value = true
  await nextTick()
  await box.value?.focus()
}
function closeReply() {
  replying.value = false
  replyTo.value = null
  draft.value = ''
}
async function send(text: string) {
  const i = item.value
  if (!i || !text || sending.value) return
  sending.value = true
  try {
    await api.slackReply(i.id, text, replyThread.value)
    toast.success(replyThread.value ? 'Replied in the thread' : `Sent to ${i.channelName}`)
    closeReply()
    // Show the new message when it lands in the conversation being shown
    if (i.threadTs || !replyThread.value) counts.value = { ...counts.value, after: counts.value.after + 1 }
    const thread = replyThread.value
    await resync()
    // A reply into an expanded thread shows up in it
    const parent = thread && ctx.value?.messages.find((x) => x.ts === thread)
    if (parent && threads.value[thread]?.open) toggleThread(parent, true)
  } catch (e) {
    toast.error(`Couldn't send: ${(e as Error).message}`)
  } finally {
    sending.value = false
  }
}
/** A message's Slack link: the workspace from the item's permalink; thread replies open in their thread */
function messageLink(m: SlackMessage, parentTs?: string): string | null {
  const i = item.value
  const origin = i?.permalink ? new URL(i.permalink).origin : null
  if (!i || !origin) return null
  const url = `${origin}/archives/${i.channelId}/p${m.ts.replace('.', '')}`
  const thread = parentTs ?? i.threadTs
  return thread && m.ts !== thread ? `${url}?thread_ts=${thread}&cid=${i.channelId}` : url
}

/** Threads expanded under conversation messages (by the parent's ts) */
const threads = ref<Record<string, { open: boolean; loading: boolean; replies: SlackMessage[] | null; error?: string }>>({})
async function toggleThread(m: SlackMessage, force = false) {
  const i = item.value
  if (!i) return
  threads.value[m.ts] ??= { open: false, loading: false, replies: null }
  // Read it back through the reactive record (the object just assigned isn't reactive itself)
  const t = threads.value[m.ts]
  t.open = force || !t.open
  if (!t.open || (t.replies && !force) || t.loading) return
  t.loading = true
  t.error = undefined
  try {
    t.replies = await api.slackThread(i.id, m.ts)
  } catch (e) {
    t.error = (e as Error).message
  } finally {
    t.loading = false
  }
}

/** Copies at least what's loaded (and 20 messages either side) as a Markdown brief */
const copying = ref(false)
async function copyPrompt() {
  if (!item.value || copying.value) return
  copying.value = true
  await copySlackPrompt(item.value, counts.value.before, counts.value.after)
  copying.value = false
}
</script>

<template>
  <SidePanel :open="!!item" @close="deck.selectedSlackId = null">
    <template v-if="item" #actions>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Copy the conversation as an AI prompt" :disabled="copying" @click="copyPrompt"><PhCircleNotch v-if="copying" class="animate-spin" /><PhRobot v-else /></Button>
        </TooltipTrigger>
        <TooltipContent>Copy the conversation as an AI prompt</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Reload from Slack" :disabled="resyncing" @click="resync">
            <PhArrowsClockwise :class="{ 'animate-spin': resyncing }" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload the conversation from Slack</TooltipContent>
      </Tooltip>
      <!-- To the release this message is about -->
      <template v-if="releaseId">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Open on the Releases page" @click="nav.openReleases(releaseId!, isHotfix ? 'hotfixes' : 'releases')"><PhRocketLaunch /></Button>
          </TooltipTrigger>
          <TooltipContent>Open the release this message is about</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Show in the release graph" @click="nav.openGraph(releaseId!, releaseId!.split('#')[0])"><PhGraph /></Button>
          </TooltipTrigger>
          <TooltipContent>Show in the release graph</TooltipContent>
        </Tooltip>
      </template>
    </template>
    <template v-if="item" #header>
      <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="muted" class="gap-1"><component :is="KIND[item.kind].icon" />{{ KIND[item.kind].label }}</Badge>
        <span>{{ item.channelName }}</span>
        <Badge v-if="item.threadTs" variant="muted">in thread</Badge>
      </div>
      <h2 class="mt-1.5 flex items-start gap-2 font-semibold"><KindIcon kind="slack" /><span class="min-w-0 pt-0.5">{{ item.userName }}</span></h2>
      <ExternalLink v-if="item.permalink" :href="item.permalink" icon="always" class="mt-1 text-sm text-primary">Open in Slack</ExternalLink>
    </template>

    <ScrollArea v-if="item" class="min-h-0 flex-1">
      <div ref="list" class="space-y-2 p-4">
        <p class="text-xs text-muted-foreground">{{ item.threadTs ? 'In the thread' : 'In the conversation' }}</p>
        <template v-if="ctx">
          <!-- More conversation above: faded placeholder rows and a button to load them -->
          <div v-if="ctx.hasBefore" class="space-y-1">
            <div class="pointer-events-none space-y-1 [mask-image:linear-gradient(to_bottom,transparent,black)]" aria-hidden="true">
              <div v-for="i in 2" :key="i" class="flex gap-3 px-3 py-2">
                <Skeleton class="size-7 rounded-full" />
                <div class="flex-1 space-y-2"><Skeleton class="h-3 w-28" /><Skeleton class="h-3" :class="i === 1 ? 'w-3/5' : 'w-4/5'" /></div>
              </div>
            </div>
            <Button variant="ghost" size="sm" class="w-full text-muted-foreground" :disabled="!!loading" @click="more('before')">
              <PhCircleNotch v-if="loading === 'before'" class="animate-spin" /><PhArrowUp v-else /> Load 5 earlier messages
            </Button>
          </div>
          <div
            v-for="m in ctx.messages"
            :key="m.ts"
            :data-target="m.isTarget || undefined"
            :class="
              cn(
                'group relative flex gap-3 rounded-lg border p-3',
                m.isTarget ? 'border-primary bg-primary/10' : replyTo?.ts === m.ts ? 'border-border bg-accent' : 'border-transparent',
              )
            "
          >
            <SlackUserCard :user-id="m.user" :name="m.userName" :avatar="m.userAvatar">
              <Avatar class="size-7 shrink-0">
                <AvatarImage v-if="m.userAvatar" :src="m.userAvatar" :alt="m.userName" />
                <AvatarFallback class="text-[10px]">{{ m.userName.slice(0, 2).toUpperCase() }}</AvatarFallback>
              </Avatar>
            </SlackUserCard>
            <!-- Message actions, on hover / focus -->
            <div class="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="outline" size="icon-xs" class="bg-background" aria-label="Reply to this message" @click="startReply(m)">
                    <PhArrowBendUpLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ item.threadTs ? 'Reply in the thread' : 'Reply in its thread' }}</TooltipContent>
              </Tooltip>
              <Tooltip v-if="messageLink(m)">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="icon-xs" class="bg-background" as="a" :href="messageLink(m)!" target="_blank" rel="noopener" aria-label="Open in Slack">
                    <PhArrowSquareOut />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open in Slack</TooltipContent>
              </Tooltip>
              <Tooltip v-if="messageLink(m)">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="icon-xs" class="bg-background" aria-label="Copy link" @click="copyText(messageLink(m)!, 'link')">
                    <PhLink />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-xs">
                <SlackUserCard :user-id="m.user" :name="m.userName" :avatar="m.userAvatar">
                  <span class="font-semibold hover:underline">{{ m.userName }}</span>
                </SlackUserCard>
                <span class="text-muted-foreground" :title="m.postedAt">{{ timeAgo(m.postedAt) }}</span>
                <Badge v-if="m.isTarget" variant="primary" class="h-4 text-[10px]">{{ KIND[item.kind].label }}</Badge>
              </div>
              <SlackText :text="m.text" :rich="m.rich" class="mt-0.5 text-sm" />
              <!-- Its thread, expandable in place -->
              <template v-if="m.replyCount">
                <Button variant="ghost" size="xs" class="-ml-2 mt-1 text-primary" :aria-expanded="!!threads[m.ts]?.open" @click="toggleThread(m)">
                  <PhCircleNotch v-if="threads[m.ts]?.loading" class="animate-spin" />
                  <PhCaretRight v-else :class="cn('transition-transform', threads[m.ts]?.open && 'rotate-90')" />
                  {{ m.replyCount }} {{ m.replyCount === 1 ? 'reply' : 'replies' }}
                </Button>
                <div v-if="threads[m.ts]?.open" class="mt-1 space-y-2 border-l-2 pl-3">
                  <p v-if="threads[m.ts].error" class="text-xs text-destructive">{{ threads[m.ts].error }}</p>
                  <div v-for="r in threads[m.ts].replies ?? []" :key="r.ts" class="group/reply relative flex gap-2">
                    <SlackUserCard :user-id="r.user" :name="r.userName" :avatar="r.userAvatar">
                      <Avatar class="size-5 shrink-0">
                        <AvatarImage v-if="r.userAvatar" :src="r.userAvatar" :alt="r.userName" />
                        <AvatarFallback class="text-[9px]">{{ r.userName.slice(0, 2).toUpperCase() }}</AvatarFallback>
                      </Avatar>
                    </SlackUserCard>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 text-xs">
                        <SlackUserCard :user-id="r.user" :name="r.userName" :avatar="r.userAvatar">
                          <span class="font-semibold hover:underline">{{ r.userName }}</span>
                        </SlackUserCard>
                        <span class="text-muted-foreground" :title="r.postedAt">{{ timeAgo(r.postedAt) }}</span>
                        <span class="flex-1" />
                        <a
                          v-if="messageLink(r, m.ts)"
                          :href="messageLink(r, m.ts)!"
                          target="_blank"
                          rel="noopener"
                          class="text-muted-foreground opacity-0 transition-opacity group-hover/reply:opacity-100 hover:text-foreground focus-visible:opacity-100"
                          aria-label="Open in Slack"
                          :title="externalHint(messageLink(r, m.ts))"
                        ><PhArrowSquareOut /></a>
                      </div>
                      <SlackText :text="r.text" :rich="r.rich" class="mt-0.5 text-sm" />
                    </div>
                  </div>
                  <Button v-if="threads[m.ts].replies" variant="ghost" size="xs" class="-ml-2 text-muted-foreground" @click="startReply(m)">
                    <PhArrowBendUpLeft /> Reply in thread
                  </Button>
                </div>
              </template>
            </div>
          </div>
          <!-- More conversation below -->
          <div v-if="ctx.hasAfter" class="space-y-1">
            <Button variant="ghost" size="sm" class="w-full text-muted-foreground" :disabled="!!loading" @click="more('after')">
              <PhCircleNotch v-if="loading === 'after'" class="animate-spin" /><PhArrowDown v-else /> Load 5 later messages
            </Button>
            <div class="pointer-events-none space-y-1 [mask-image:linear-gradient(to_top,transparent,black)]" aria-hidden="true">
              <div v-for="i in 2" :key="i" class="flex gap-3 px-3 py-2">
                <Skeleton class="size-7 rounded-full" />
                <div class="flex-1 space-y-2"><Skeleton class="h-3 w-24" /><Skeleton class="h-3" :class="i === 1 ? 'w-4/5' : 'w-1/2'" /></div>
              </div>
            </div>
          </div>
        </template>
        <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
        <template v-else>
          <div v-for="i in 3" :key="i" class="flex gap-3 p-3">
            <Skeleton class="size-7 rounded-full" />
            <div class="flex-1 space-y-2"><Skeleton class="h-3 w-32" /><Skeleton class="h-3 w-full" /></div>
          </div>
        </template>
      </div>
    </ScrollArea>
    <SlackReplyBox
      v-if="item && replying"
      ref="box"
      v-model="draft"
      v-model:height="sv.replyHeight"
      :label="replyLabel"
      :quote="replyTo?.text"
      :people="people"
      :sending="sending"
      @send="send"
      @cancel="closeReply"
    />
    <template v-if="item" #footer>
      <SlackActions :item="item" labelled :can-reply="!replying" @reply="startReply()" />
    </template>
  </SidePanel>
</template>
