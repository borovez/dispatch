<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowClockwise, PhCheck, PhCopy, PhRobot } from '@phosphor-icons/vue'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import MarkdownEditor from './MarkdownEditor.vue'
import CodeBlock from './CodeBlock.vue'

/**
 * The setup brief for an AI agent (`GET /setup/prompt`): what's connected, what's missing, where each token
 * comes from. Opened from the first-run banner and Settings (`deck.setupPromptOpen`). Rebuild refreshes the
 * status as things get connected.
 */
const deck = useDeck()
const open = computed({ get: () => deck.setupPromptOpen, set: (v) => (deck.setupPromptOpen = v) })
const prompt = ref('')
const loading = ref(false)
const copied = ref(false)

async function load() {
  loading.value = true
  copied.value = false
  try {
    prompt.value = (await api.setupPrompt()).prompt
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    loading.value = false
  }
}
watch(open, (o) => o && load(), { immediate: true })

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt.value)
    copied.value = true
    toast.success('Setup prompt copied', { description: 'Paste it into Claude Code (or another agent).' })
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    toast.error('Copy failed: select the text and copy it')
  }
}
const fetchCmd = computed(() => `claude "$(curl -s '${location.origin}/api/setup/prompt?text=1')"`)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[85vh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2"><PhRobot class="text-primary" /> Set up Dispatch with an AI agent</DialogTitle>
        <DialogDescription>
          A brief for Claude Code or any agent: what's connected, what's missing, where each token comes from and which scopes it needs.
          It contains no secrets, and tells the agent to have you paste tokens into Settings, never into the chat.
        </DialogDescription>
      </DialogHeader>
      <Skeleton v-if="loading" class="min-h-0 flex-1" />
      <MarkdownEditor v-else v-model="prompt" fill mono />
      <div class="space-y-1">
        <p class="text-xs text-muted-foreground">Or start Claude Code with it straight from a terminal:</p>
        <CodeBlock :code="fetchCmd" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">{{ prompt.split('\n').length }} lines · {{ prompt.length.toLocaleString() }} characters</span>
        <span class="flex-1" />
        <Button variant="ghost" size="sm" :disabled="loading" title="Build it again with the latest status" @click="load"><PhArrowClockwise /> Rebuild</Button>
        <Button size="sm" :disabled="loading || !prompt" @click="copy">
          <PhCheck v-if="copied" /><PhCopy v-else /> {{ copied ? 'Copied' : 'Copy prompt' }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
