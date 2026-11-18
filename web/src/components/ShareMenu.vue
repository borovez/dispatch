<script setup lang="ts">
import { PhCheck, PhCopy, PhExport, PhHash, PhLink, PhMarkdownLogo, PhTextAa } from '@phosphor-icons/vue'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { writeClipboard } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Share the item a side panel shows without leaving Dispatch: copy its link (plain, or with its title as
 * a rich link that pastes as a titled link in Slack, Docs, Jira…), as Markdown, its key / reference,
 * or the system share sheet where there is one.
 */
const props = defineProps<{
  url: string
  /** Key or reference, e.g. LDW-1730 or org/repo#12 (none for a Slack message) */
  refLabel?: string
  title?: string
  /** Noun for the tooltip and toasts, e.g. "issue" */
  what: string
}>()

/** Feedback: the button turns green with a check for a moment, and a "Copied!" toast each time */
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function copiedFeedback(what: string) {
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 2000)
  toast.success('Copied!', { description: what })
}

const label = () => [props.refLabel, props.title].filter(Boolean).join(': ') || props.url
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function copy(text: string, what: string, html?: string) {
  try {
    await writeClipboard(text, html)
    copiedFeedback(what)
  } catch {
    toast.error(`Couldn't copy the ${what.toLowerCase()}`)
  }
}
/** Link with the title as its text: HTML for apps that paste rich text, the plain URL elsewhere */
const copyRich = () => copy(props.url, 'Link with title: pastes as a titled link in Slack, Docs and Jira', `<a href="${escape(props.url)}">${escape(label())}</a>`)

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
async function share() {
  try {
    await navigator.share({ title: label(), url: props.url })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast.error(`Couldn't share the ${props.what}`)
  }
}
</script>

<template>
  <!-- Tooltip around the whole menu: nested inside it, the menu's trigger anchored to the tooltip and the menu was never positioned -->
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :class="copied && 'bg-success/15 text-success hover:bg-success/20 hover:text-success'"
              :aria-label="copied ? 'Copied' : `Share this ${what}`"
            >
              <PhCheck v-if="copied" weight="bold" />
              <PhExport v-else />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-64">
            <DropdownMenuItem @select="copy(url, 'Link')"><PhLink /> Copy link</DropdownMenuItem>
            <DropdownMenuItem @select="copyRich"><PhTextAa /> Copy link with title</DropdownMenuItem>
            <DropdownMenuItem @select="copy(`[${label()}](${url})`, 'Markdown link')"><PhMarkdownLogo /> Copy as Markdown</DropdownMenuItem>
            <DropdownMenuItem v-if="refLabel" @select="copy(refLabel!, refLabel!)">
              <PhHash /> Copy {{ refLabel.includes('#') ? 'reference' : 'key' }}
              <DropdownMenuShortcut class="max-w-28 truncate font-mono">{{ refLabel }}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="title" @select="copy(title!, 'Title')"><PhCopy /> Copy title</DropdownMenuItem>
            <template v-if="canShare">
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="share"><PhExport /> Share…</DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ copied ? 'Copied' : `Share: copy the link to this ${what}` }}</TooltipContent>
  </Tooltip>
</template>
