<script setup lang="ts">
import { computed, nextTick, ref, type HTMLAttributes } from 'vue'
import { PhEye, PhPencilSimple } from '@phosphor-icons/vue'
import { formatActions, pasteLink, runFormatShortcut, type FormatAction } from '@/composables/markdownFormat'
import { markdownToAdf } from '@shared/adf'
import { cn } from '@/lib/utils'
import AdfView from './AdfView.vue'
import ResizeHandle from './ResizeHandle.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The Markdown field used everywhere: one bordered box with the formatting toolbar (GitHub's shortcuts)
 * and a Preview toggle (opens in edit mode), then the text. The preview defaults to the Jira document the server would send;
 * the `preview` slot ({ value }) renders it some other way (e.g. as Slack shows it). The `toolbar` slot
 * adds buttons after the formatting ones. Keydown is re-emitted after the format shortcuts so a parent
 * can add its own keys (Enter to send…).
 */
const props = withDefaults(
  defineProps<{
    label?: string
    placeholder?: string
    /** Grow with the text (about 2 to 8 lines) instead of a fixed height */
    grow?: boolean
    /** Fill the parent's height (a flex column) instead of a fixed height */
    fill?: boolean
    /** Previews for attachment:name images in the text */
    images?: Record<string, string>
    /** Adds ~~strikethrough~~ to the toolbar */
    strike?: boolean
    /** Monospaced text (prompts, code-heavy text) */
    mono?: boolean
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  {},
)
const emit = defineEmits<{ blur: []; keydown: [e: KeyboardEvent] }>()
const model = defineModel<string>({ required: true })
/** Always opens for editing; Preview is a quick look, not remembered */
const preview = ref(false)
const doc = computed(() => markdownToAdf(model.value))

const textarea = ref<{ $el: HTMLTextAreaElement } | null>(null)
const el = () => textarea.value?.$el
const ACTIONS = computed(() => formatActions({ strike: props.strike }))
function apply(a: FormatAction) {
  const t = el()
  if (t) a.run(t)
}
function onKeydown(e: KeyboardEvent) {
  if (runFormatShortcut(ACTIONS.value, e)) return
  emit('keydown', e)
}

// Text and preview share one height (v-model:height to keep it; 288 px otherwise), set with the grab bar
const height = defineModel<number>('height', { default: 288 })
const startHeight = height.value
const sized = computed(() => (props.fill || props.grow ? undefined : { height: `${height.value}px` }))

async function focus() {
  preview.value = false
  await nextTick()
  el()?.focus()
}
defineExpose({ focus, el })
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', fill && 'min-h-0 flex-1', props.class)">
    <div v-if="label || $slots.label" class="shrink-0"><slot name="label"><Label>{{ label }}</Label></slot></div>
    <div
      :class="
        cn(
          'flex flex-col rounded-md border bg-background transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
          fill && 'min-h-0 flex-1',
          disabled && 'opacity-60',
        )
      "
    >
      <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label="Formatting">
        <template v-if="!preview">
          <Tooltip v-for="a in ACTIONS" :key="a.label">
            <TooltipTrigger as-child>
              <!-- mousedown.prevent keeps the textarea's selection -->
              <Button type="button" variant="ghost" size="icon-xs" :disabled="disabled" :aria-label="`${a.label} (${a.keys})`" @mousedown.prevent @click="apply(a)">
                <component :is="a.icon" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ a.label }} <span class="opacity-70">{{ a.keys }}</span></TooltipContent>
          </Tooltip>
          <slot name="toolbar" />
        </template>
        <span class="flex-1" />
        <Toggle v-model="preview" size="sm" class="h-6 shrink-0 gap-1 px-2 text-xs" :aria-label="preview ? 'Edit' : 'Preview'">
          <PhPencilSimple v-if="preview" /><PhEye v-else /> {{ preview ? 'Edit' : 'Preview' }}
        </Toggle>
      </div>
      <div
        v-if="preview"
        :class="cn('overflow-y-auto px-3 py-2 text-sm', fill && 'min-h-0 flex-1', grow && 'max-h-48 min-h-16')"
        :style="sized"
      >
        <slot name="preview" :value="model">
          <AdfView v-if="doc.content.length" :doc="doc" :images="images" />
        </slot>
        <p v-if="!model.trim()" class="text-muted-foreground">Nothing to preview.</p>
      </div>
      <Textarea
        v-else
        ref="textarea"
        v-model="model"
        :placeholder="placeholder"
        :disabled="disabled"
        :class="
          cn(
            'rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent',
            mono ? 'font-mono text-xs leading-relaxed' : 'text-sm',
            fill ? 'field-sizing-fixed min-h-0 flex-1 resize-none' : grow ? 'max-h-48 min-h-16 resize-none' : 'field-sizing-fixed resize-none',
          )
        "
        :style="sized"
        @paste="pasteLink"
        @keydown="onKeydown"
        @blur="emit('blur')"
      />
    </div>
    <!-- Fixed height: a grab bar sizes the text (and preview) -->
    <ResizeHandle v-if="!fill && !grow" v-model="height" :min="64" :reset="startHeight" class="relative z-10 -mt-1 -mb-1.5" />
  </div>
</template>
