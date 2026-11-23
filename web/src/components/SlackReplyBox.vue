<script setup lang="ts">
import { computed, ref } from 'vue'
import { caretCoords } from '@/lib/caretCoords'
import { useListNav } from '@/composables/listNav'
import { PhArrowBendUpLeft, PhAt, PhCircleNotch, PhPaperPlaneRight, PhX } from '@phosphor-icons/vue'
import { markdownToMrkdwn } from '@shared/slackMarkdown'
import { inCodeBlock, insertAtCursor, replaceRange } from '@/composables/markdownFormat'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { emojiText, searchEmoji, useSlackEmoji, type EmojiItem } from '@/composables/slackEmoji'
import EmojiPicker from './EmojiPicker.vue'
import Kbd from './Kbd.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import ResizeHandle from './ResizeHandle.vue'

/**
 * Slack reply box: the shared MarkdownEditor, live (Markdown and @mentions styled as you type; toolbar with
 * strikethrough and an @mention menu of the people in the conversation). Sends Slack mrkdwn (`markdownToMrkdwn`).
 * Typing @ opens a list of the people in the conversation at the caret, :name (2+ letters) a list of emoji
 * (arrows, Enter or Tab picks, Escape closes it); typing the closing colon of a known :name: makes it the
 * emoji. The toolbar has an emoji picker (EmojiPicker) that inserts at the caret. Enter sends, Shift+Enter is a new line (inside a ``` block Enter is a new line, Cmd/Ctrl+Enter sends); Escape cancels. Drag the line above it to make it taller.
 */
const props = defineProps<{ label: string; quote?: string | null; people: { id: string; name: string }[]; sending?: boolean }>()
const emit = defineEmits<{ send: [mrkdwn: string]; cancel: [] }>()
const draft = defineModel<string>({ required: true })
/** Box height in px set by dragging the line above it; 0: grows with the text */
const height = defineModel<number>('height', { default: 0 })
/** Formatting marks shown in the text (the toolbar's Aa toggle) */
const marks = defineModel<boolean>('marks', { default: false })
const root = ref<HTMLElement | null>(null)

const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const mentions = computed(() => Object.fromEntries(props.people.map((p) => [p.name, p.id])))

function mention(name: string) {
  const t = editor.value?.el()
  if (!t) return
  const before = t.value.slice(0, t.selectionStart)
  const after = t.value.slice(t.selectionEnd)
  // A space on each side, unless one is there already
  insertAtCursor(t, `${before && !/\s$/.test(before) ? ' ' : ''}@${name}${/^\s/.test(after) ? '' : ' '}`)
}

// Autocomplete at the caret: @name (people in the conversation) or :name (emoji, 2+ letters, not in code)
const typing = ref<{ kind: 'mention' | 'emoji'; start: number; query: string; left: number; top: number } | null>(null)
const active = ref(0)
const list = ref<HTMLElement | null>(null)
type Option = { key: string; name: string; emoji?: EmojiItem }
const matches = computed<Option[]>(() => {
  const t = typing.value
  if (!t) return []
  if (t.kind === 'emoji') return searchEmoji(t.query, 8).map((e) => ({ key: e.name, name: e.name, emoji: e }))
  const q = t.query.toLowerCase()
  return props.people
    .filter((p) => !q || p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
    .slice(0, 8)
    .map((p) => ({ key: p.id, name: p.name }))
})
const nav = useListNav({ items: () => matches.value, active, container: () => list.value })
const { emoji } = useSlackEmoji()

/** The caret is inside a ``` block (the hint says Enter is a new line there) */
const inCode = ref(false)

function track() {
  const t = editor.value?.el()
  inCode.value = !!t && inCodeBlock(t)
  if (!t || t.selectionStart !== t.selectionEnd) return (typing.value = null)
  const before = t.value.slice(0, t.selectionStart)
  const place = (kind: 'mention' | 'emoji', start: number, query: string) => {
    const at = t.coordsAt ? t.coordsAt(start) : caretCoords(t as HTMLTextAreaElement, start)
    if (typing.value?.start !== start || typing.value.kind !== kind) active.value = 0
    typing.value = { kind, start, query, left: at.left, top: at.top }
  }
  const em = !inCode.value ? /(?:^|[\s(])(:([a-z0-9_+'-]{2,30}))$/i.exec(before) : null
  if (em && searchEmoji(em[2]!, 1).length) return place('emoji', t.selectionStart - em[1]!.length, em[2]!)
  if (!props.people.length) return (typing.value = null)
  const m = /(?:^|[^\w@])@([^\s@][^@\n]{0,40})?$/.exec(before)
  if (!m) return (typing.value = null)
  const query = m[1] ?? ''
  const start = t.selectionStart - query.length - 1
  const q = query.toLowerCase()
  // A space after the name typed so far: keep the list only while a name still matches
  if (/\s/.test(query) && !props.people.some((p) => p.name.toLowerCase().startsWith(q))) return (typing.value = null)
  place('mention', start, query)
}

/** Typing the closing colon of a known :name: swaps it for the emoji (custom ones stay as :name:, Slack shows them) */
function onInput(e: Event) {
  const t = editor.value?.el()
  if (t && (e as InputEvent).data === ':' && t.selectionStart === t.selectionEnd && !inCodeBlock(t)) {
    const m = /(?:^|[\s(]):([a-z0-9_+'-]+):$/i.exec(t.value.slice(0, t.selectionStart))
    const found = m && emoji(m[1]!)
    if (found && 'char' in found) replaceRange(t, t.selectionStart - m![1]!.length - 2, t.selectionStart, found.char)
  }
  track()
}

/** The toolbar picker's choice, at the caret */
function insertEmoji(e: EmojiItem) {
  const t = editor.value?.el()
  if (t) insertAtCursor(t, emojiText(e))
}

function pick(o: Option) {
  const t = editor.value?.el()
  if (!t || !typing.value) return
  replaceRange(t, typing.value.start, t.selectionStart, o.emoji ? emojiText(o.emoji) : `@${o.name} `)
  typing.value = null
}

function send() {
  if (!draft.value.trim() || props.sending) return
  emit('send', markdownToMrkdwn(draft.value, { mentions: mentions.value }))
}
function onKeydown(e: KeyboardEvent) {
  if (typing.value && matches.value.length) {
    if (nav.onArrow(e)) return
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      pick(matches.value[active.value]!)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      typing.value = null
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    // Inside a ``` block Enter is a new line; Cmd/Ctrl+Enter always sends
    const t = e.target as HTMLTextAreaElement
    if (!e.metaKey && !e.ctrlKey && inCodeBlock(t)) return
    e.preventDefault()
    send()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
  }
}

const focus = () => editor.value?.focus()
defineExpose({ focus })
</script>

<template>
  <div
    ref="root"
    :class="['relative flex shrink-0 flex-col gap-2 p-3', height && 'min-h-0']"
    :style="height ? { height: `${height}px` } : undefined"
    @input="onInput"
    @click="track"
    @keyup="(e: KeyboardEvent) => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && track()"
    @focusout="typing = null"
  >
    <ResizeHandle
      line
      invert
      :model-value="height || 200"
      :min="160"
      :reset="0"
      :target="() => root"
      class="absolute inset-x-0 -top-2.5 z-10"
      @update:model-value="(h) => (height = h)"
    />
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <PhArrowBendUpLeft class="shrink-0" />
      <span class="shrink-0 font-medium text-foreground">{{ label }}</span>
      <span v-if="quote" class="min-w-0 flex-1 truncate">“{{ quote }}”</span>
      <span v-else class="flex-1" />
      <Button variant="ghost" size="icon-xs" aria-label="Cancel the reply" @click="emit('cancel')"><PhX /></Button>
    </div>
    <MarkdownEditor
      ref="editor"
      v-model="draft"
      :grow="!height"
      :fill="!!height"
      strike
      live
      v-model:marks="marks"
      :mentions="people.map((p) => p.name)"
      placeholder="Write a reply… Markdown works: **bold**, _italic_, `code`, - lists, @name"
      :disabled="sending"
      @keydown="onKeydown"
    >
      <template #toolbar>
        <!-- Tooltip around the whole menu: nested inside it, the menu's trigger anchored to the tooltip and the menu was never positioned -->
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-flex">
              <DropdownMenu v-if="people.length">
                <DropdownMenuTrigger as-child>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Mention someone" @mousedown.prevent><PhAt /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" @close-auto-focus.prevent="editor?.el()?.focus()">
                  <DropdownMenuLabel class="text-xs text-muted-foreground">In this conversation</DropdownMenuLabel>
                  <DropdownMenuItem v-for="p in people" :key="p.id" @select="mention(p.name)">@{{ p.name }}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </TooltipTrigger>
          <TooltipContent>Mention someone</TooltipContent>
        </Tooltip>
        <EmojiPicker @pick="insertEmoji" @close-auto-focus="(e: Event) => (e.preventDefault(), editor?.el()?.focus())" />
      </template>
    </MarkdownEditor>
    <Teleport to="body">
      <!-- Above the caret's line (the box sits at the bottom of the panel); mousedown.prevent keeps the textarea focused -->
      <div
        v-if="typing && matches.length"
        ref="list"
        role="listbox"
        :aria-label="typing.kind === 'emoji' ? 'Emoji' : 'Mention someone'"
        class="fixed z-50 max-h-64 w-60 -translate-y-full overflow-y-auto rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        :style="{ left: `${typing.left}px`, top: `${typing.top - 4}px` }"
        @mousedown.prevent
      >
        <div
          v-for="(o, i) in matches"
          :key="o.key"
          role="option"
          :aria-selected="i === active"
          :data-active="i === active || undefined"
          :class="['flex cursor-default items-center gap-1 rounded-sm px-2 py-1.5', i === active && 'bg-accent text-accent-foreground']"
          @mouseenter="active = i"
          @click="pick(o)"
        >
          <template v-if="o.emoji">
            <img v-if="o.emoji.url" :src="o.emoji.url" :alt="o.name" class="size-5 shrink-0 object-contain" />
            <span v-else class="w-5 shrink-0 text-center text-base leading-none">{{ o.emoji.char }}</span>
            <span class="truncate text-muted-foreground">:{{ o.name }}:</span>
          </template>
          <template v-else><span class="text-merged">@</span><span class="truncate">{{ o.name }}</span></template>
        </div>
      </div>
    </Teleport>
    <div class="flex items-center gap-2">
      <p v-if="inCode" class="flex-1 text-xs text-muted-foreground">In a code block: <Kbd>↵</Kbd> new line · <Kbd>⌘↵</Kbd> send</p>
      <p v-else class="flex-1 text-xs text-muted-foreground"><Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> new line · <Kbd>```</Kbd> code block</p>
      <Button size="sm" :disabled="sending || !draft.trim()" @click="send">
        <PhCircleNotch v-if="sending" class="animate-spin" /><PhPaperPlaneRight v-else /> Send
      </Button>
    </div>
  </div>
</template>
