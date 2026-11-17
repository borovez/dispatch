<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowsClockwise, PhArrowSquareOut, PhCircleNotch, PhWarningCircle } from '@phosphor-icons/vue'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { parsePrRef } from '@/lib/prRef'
import { Button } from '@/components/ui/button'
import KindIcon from './KindIcon.vue'
import RepoName from './RepoName.vue'
import SidePanel from './SidePanel.vue'

/**
 * The side panel for a PR Dispatch doesn't have yet (a chain step or dependency shown as "not synced"):
 * what is known about it, Sync this PR (fetches and stores it, then the PR panel takes over) and Open
 * on GitHub. Open while a PR id is selected that isn't in the store.
 */
const deck = useDeck()
const id = computed(() => (deck.selectedId && !deck.selected ? deck.selectedId : null))
const ref_ = computed(() => (id.value ? parsePrRef(id.value) : null))
const url = computed(() => (ref_.value ? `https://github.com/${ref_.value.owner}/${ref_.value.name}/pull/${ref_.value.number}` : undefined))
/** What the PRs Dispatch has say about it */
const waitsFor = computed(() => (id.value ? (deck.overview?.edges ?? []).filter((e) => e.from === id.value).map((e) => e.to) : []))
const blocks = computed(() => (id.value ? (deck.overview?.edges ?? []).filter((e) => e.to === id.value).map((e) => e.from) : []))

const syncing = ref(false)
async function sync() {
  if (!id.value || syncing.value) return
  syncing.value = true
  await deck.mutate(() => api.fetchPr(id.value!), `Synced ${id.value}`)
  syncing.value = false
}
</script>

<template>
  <SidePanel :open="!!id" @close="deck.selectedId = null">
    <template v-if="id" #header>
      <h2 class="flex items-start gap-2 leading-snug font-semibold">
        <KindIcon kind="pr" />
        <span class="min-w-0 pt-0.5 font-mono text-sm"><RepoName :id="id" /></span>
      </h2>
    </template>
    <div v-if="id" class="space-y-4 p-4 text-sm">
      <div class="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
        <PhWarningCircle :size="18" class="mt-0.5 shrink-0 text-warning" />
        <div class="space-y-1">
          <p class="font-medium">Not synced yet</p>
          <p class="text-muted-foreground">
            Dispatch knows this PR only from another PR's description, so it has no title, state or checks for it.
            Sync it to see it here; the next full sync keeps it while something links to it.
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button :disabled="syncing" @click="sync">
          <PhCircleNotch v-if="syncing" class="animate-spin" /><PhArrowsClockwise v-else /> Sync this PR
        </Button>
        <Button v-if="url" variant="outline" as="a" :href="url" target="_blank" rel="noopener"><PhArrowSquareOut /> Open on GitHub</Button>
      </div>
      <section v-if="waitsFor.length || blocks.length" class="space-y-1.5">
        <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Linked</h3>
        <p v-for="t in waitsFor" :key="`w${t}`" class="flex items-center gap-1.5 text-xs">
          <span class="text-muted-foreground">Waits for</span>
          <button class="min-w-0 font-mono text-primary hover:underline" @click="deck.selectedId = t"><RepoName :id="t" /></button>
        </p>
        <p v-for="b in blocks" :key="`b${b}`" class="flex items-center gap-1.5 text-xs">
          <span class="text-muted-foreground">Blocks</span>
          <button class="min-w-0 font-mono text-primary hover:underline" @click="deck.selectedId = b"><RepoName :id="b" /></button>
        </p>
      </section>
    </div>
  </SidePanel>
</template>
