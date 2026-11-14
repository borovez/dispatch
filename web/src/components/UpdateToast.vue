<script setup lang="ts">
import { PhInfo, PhX } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'

/**
 * "Dispatch X is available" toast (toast.custom): text on top, buttons underneath, so the two buttons
 * don't squeeze the text into a narrow column the way a regular toast's single row does.
 */
defineProps<{ latest: string; current: string; actionLabel: string }>()
const emit = defineEmits<{ closeToast: []; action: []; whatsNew: [] }>()
</script>

<template>
  <div class="relative flex w-[356px] max-w-[calc(100vw-2rem)] gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
    <PhInfo :size="18" class="mt-px shrink-0 text-info" />
    <div class="min-w-0 flex-1 space-y-3">
      <div class="pr-5">
        <div class="font-medium">Dispatch {{ latest }} is available</div>
        <div class="text-muted-foreground">You have {{ current }}.</div>
      </div>
      <div class="flex gap-2">
        <Button size="sm" @click="emit('action'), emit('closeToast')">{{ actionLabel }}</Button>
        <Button size="sm" variant="outline" @click="emit('whatsNew'), emit('closeToast')">What’s new</Button>
      </div>
    </div>
    <button class="absolute top-3 right-3 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close" @click="emit('closeToast')">
      <PhX :size="14" />
    </button>
  </div>
</template>
