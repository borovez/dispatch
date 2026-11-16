<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowBendUpLeft, PhAt, PhCircleNotch, PhPaperPlaneRight, PhX } from '@phosphor-icons/vue'
import { markdownToMrkdwn } from '@shared/slackMarkdown'
import { insertAtCursor } from '@/composables/markdownFormat'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import Kbd from './Kbd.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import ResizeHandle from './ResizeHandle.vue'
import SlackText from './SlackText.vue'

/**
 * Slack reply box: the shared MarkdownEditor (toolbar with strikethrough, an @mention menu of the people
 * in the conversation, a preview as Slack will show it). Sends Slack mrkdwn (`markdownToMrkdwn`).
 * Enter sends, Shift+Enter is a new line; Escape cancels. Drag the line above it to make it taller.
 */
const props = defineProps<{ label: string; quote?: string | null; people: { id: string; name: string }[]; sending?: boolean }>()
const emit = defineEmits<{ send: [mrkdwn: string]; cancel: [] }>()
const draft = defineModel<string>({ required: true })
/** Box height in px set by dragging the line above it; 0: grows with the text */
const height = defineModel<number>('height', { default: 0 })
const root = ref<HTMLElement | null>(null)

const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const mentions = computed(() => Object.fromEntries(props.people.map((p) => [p.name, p.id])))
const asSlack = (md: string) => markdownToMrkdwn(md, { mentions: mentions.value, labels: true })

function mention(name: string) {
  const t = editor.value?.el()
  if (!t) return
  const before = t.value.slice(0, t.selectionStart)
  insertAtCursor(t, `${before && !/\s$/.test(before) ? ' ' : ''}@${name} `)
}

function send() {
  if (!draft.value.trim() || props.sending) return
  emit('send', markdownToMrkdwn(draft.value, { mentions: mentions.value }))
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.metaKey && !e.ctrlKey) {
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
      placeholder="Write a reply… Markdown works: **bold**, _italic_, `code`, - lists, @name"
      :disabled="sending"
      @keydown="onKeydown"
    >
      <template #toolbar>
        <DropdownMenu v-if="people.length">
          <Tooltip>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Mention someone" @mousedown.prevent><PhAt /></Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Mention someone</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" @close-auto-focus.prevent="editor?.el()?.focus()">
            <DropdownMenuLabel class="text-xs text-muted-foreground">In this conversation</DropdownMenuLabel>
            <DropdownMenuItem v-for="p in people" :key="p.id" @select="mention(p.name)">@{{ p.name }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
      <template #preview="{ value }">
        <SlackText v-if="value.trim()" :text="asSlack(value)" :rich="asSlack(value)" />
      </template>
    </MarkdownEditor>
    <div class="flex items-center gap-2">
      <p class="flex-1 text-xs text-muted-foreground"><Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> new line</p>
      <Button size="sm" :disabled="sending || !draft.trim()" @click="send">
        <PhCircleNotch v-if="sending" class="animate-spin" /><PhPaperPlaneRight v-else /> Send
      </Button>
    </div>
  </div>
</template>
