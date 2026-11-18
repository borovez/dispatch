<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PrView } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { PhInfo } from '@phosphor-icons/vue'
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

/**
 * Confirms "Mark as done" for a PR (`deck.markDonePr`): its current action (e.g. Needs backmerge) is
 * dismissed and it moves to Done, until it needs something else. Undo from its menu or the panel.
 */
const deck = useDeck()
// The PR is kept here while the dialog is open: its buttons close the dialog (clearing
// deck.markDonePr) before their click handlers run, so confirm can't read it from the store
const target = ref<PrView | null>(null)
watch(
  () => deck.markDonePr,
  (id) => id && (target.value = deck.byId.get(id) ?? null),
)
const pr = computed(() => target.value)
const open = computed({
  get: () => !!deck.markDonePr && !!target.value,
  set: (v) => !v && (deck.markDonePr = null),
})
const refLabel = computed(() => (pr.value ? `${pr.value.repo.split('/')[1]}#${pr.value.number}` : ''))

async function confirm() {
  const p = target.value
  if (!p) return
  const label = refLabel.value
  deck.markDonePr = null
  await deck.mutate(() => api.setDone(p.id, p.action.kind), `${label} marked done`)
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent v-if="pr">
      <AlertDialogHeader>
        <AlertDialogTitle>Mark {{ refLabel }} as done?</AlertDialogTitle>
        <AlertDialogDescription>
          It shows <strong class="text-foreground">{{ pr.action.label }}</strong><template v-if="pr.action.detail">: {{ pr.action.detail }}</template>.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Alert variant="info">
        <PhInfo />
        <AlertDescription>
          Marking it done moves it to Done and out of your action lists. If it later needs something else (conflicts, a release…), it shows
          again. You can undo this from its menu or its panel.
        </AlertDescription>
      </Alert>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="confirm">Mark as done</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
