<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { PhCircleNotch, PhPlus } from '@phosphor-icons/vue'
import type { DependencyKind, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { useDependencies } from '@/composables/dependencies'
import { onEscape } from '@/composables/escape'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import PrPicker from './PrPicker.vue'
import RepoName from './RepoName.vue'

/**
 * Inline "add a dependency" under one of the PR panel's two lists. The list it sits under sets the
 * direction (no choosing "depends on" vs "blocks"): under "Waits for" the picked PR goes first, under
 * "Waiting on this PR" this PR goes first. The only choice is merged or released, and a sentence with
 * the real PR numbers says what will be recorded.
 */
const props = defineProps<{
  pr: PrView
  /** waitsFor: this PR waits for the picked one; waitedOn: the picked one waits for this PR */
  side: 'waitsFor' | 'waitedOn'
}>()
const emit = defineEmits<{ done: [] }>()

const deck = useDeck()
const deps = useDependencies()
const v = useLayout().view('drawer', { depKind: 'merge' as DependencyKind })

const target = ref('')
const root = ref<HTMLElement | null>(null)
onMounted(() => nextTick(() => root.value?.querySelector('input')?.focus()))
onEscape(() => (emit('done'), true))

/** PRs already linked to this one can't be added again (either direction) */
function linkedReason(p: PrView): string | null {
  if (props.pr.dependsOn.some((e) => e.to === p.id)) return 'this PR already waits for it'
  if (props.pr.dependents.some((e) => e.from === p.id)) return 'already waits for this PR'
  return null
}
const sameRepo = (id: string) => id.split('#')[0]!.toLowerCase() === props.pr.repo.toLowerCase()
/** [the PR that waits, the PR that goes first]; null = the one still to pick */
const order = computed<[string | null, string | null]>(() =>
  props.side === 'waitsFor' ? [props.pr.id, target.value || null] : [target.value || null, props.pr.id],
)

async function add() {
  if (deps.busy.value || !target.value) return
  const [from, to] = order.value as [string, string]
  if (await deps.add(from, to, v.depKind)) emit('done')
}
</script>

<template>
  <form ref="root" class="mt-1.5 space-y-2 rounded-lg bg-muted/60 p-2.5" @submit.prevent="add">
    <div class="flex items-center gap-2">
      <PrPicker
        v-model="target"
        :exclude="pr.id"
        :disabled-reason="linkedReason"
        :disabled="deps.busy.value"
        :placeholder="side === 'waitsFor' ? 'Which PR must go first? Search or paste a URL' : 'Which PR waits for this one? Search or paste a URL'"
        class="h-8 min-w-0 flex-1"
        required
      />
      <ToggleGroup
        :model-value="v.depKind"
        type="single"
        variant="outline"
        size="sm"
        class="shrink-0"
        @update:model-value="(k) => k && (v.depKind = k as DependencyKind)"
      >
        <ToggleGroupItem value="merge" title="Waits until it is merged">merged</ToggleGroupItem>
        <ToggleGroupItem value="release" title="Waits until it is merged and released">released</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div class="flex items-center gap-2">
      <!-- What will be recorded, with the real PR numbers -->
      <p class="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        <template v-for="(id, i) in order" :key="i">
          <span v-if="id" class="inline-flex font-mono font-medium text-foreground"><RepoName :id="id" :short="sameRepo(id)" /></span>
          <span v-else class="italic">the PR you pick</span>
          <template v-if="id === pr.id"> (this one)</template>
          <template v-if="i === 0"> can merge only after </template>
        </template>
        is <strong class="text-foreground">{{ v.depKind === 'release' ? 'released' : 'merged' }}</strong>.
        <template v-if="deck.overview?.dependencyWrites.description">Saved in the PR description on GitHub.</template>
        <template v-else>Kept in Dispatch only.</template>
      </p>
      <Button type="button" variant="ghost" size="sm" @click="emit('done')">Cancel</Button>
      <Button size="sm" type="submit" :disabled="deps.busy.value || !target">
        <PhCircleNotch v-if="deps.busy.value" class="animate-spin" /><PhPlus v-else /> Add
      </Button>
    </div>
  </form>
</template>
