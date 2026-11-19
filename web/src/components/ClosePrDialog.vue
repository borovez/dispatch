<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { usePrState } from '@/composables/prState'
import { PhWarning } from '@phosphor-icons/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** Confirms closing a PR on GitHub (`deck.closePr`), naming the PRs that still wait on it. Reopen from its menu or panel. */
const deck = useDeck()
const prState = usePrState()
// Kept while open: the buttons close the dialog (clearing deck.closePr) before their handlers run
const target = ref<PrView | null>(null)
watch(
  () => deck.closePr,
  (id) => id && (target.value = deck.byId.get(id) ?? null),
)
const pr = computed(() => target.value)
const open = computed({
  get: () => !!deck.closePr && !!target.value,
  set: (v) => !v && (deck.closePr = null),
})
const short = (id: string) => {
  const [repo, n] = id.split('#')
  return `${repo.split('/')[1]}#${n}`
}
const refLabel = computed(() => (pr.value ? short(pr.value.id) : ''))
const waiting = computed(() => (pr.value?.dependents ?? []).filter((d) => !d.satisfied).map((d) => short(d.from)))

function confirm() {
  const p = target.value
  deck.closePr = null
  if (p) prState.change(p, 'closed', true)
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent v-if="pr">
      <AlertDialogHeader>
        <AlertDialogTitle>Close {{ refLabel }}?</AlertDialogTitle>
        <AlertDialogDescription>
          “{{ pr.title }}” is closed on GitHub without merging. You can reopen it from its menu or its panel while its branch exists.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Alert v-if="waiting.length" variant="warning">
        <PhWarning />
        <AlertDescription>{{ waiting.join(', ') }} {{ waiting.length === 1 ? 'waits' : 'wait' }} on this PR.</AlertDescription>
      </Alert>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="confirm">Close PR</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
