<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { PhMagnifyingGlass, PhX } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A search that takes a button's space: click it and the input floats over the toolbar (anchored to the
 * button's right edge), so it doesn't push anything around. With a query it stays a small pill showing it.
 * Escape clears, then closes.
 */
const props = withDefaults(defineProps<{ placeholder?: string; width?: string }>(), { placeholder: 'Search…', width: '20rem' })
const query = defineModel<string>({ required: true })
const open = ref(false)
const input = ref<InstanceType<typeof Input> | null>(null)

async function expand() {
  open.value = true
  await nextTick()
  const el = (input.value?.$el ?? null) as HTMLInputElement | null
  el?.focus()
  el?.select()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  if (query.value) query.value = ''
  else open.value = false
}
function onBlur() {
  // Keep it while the clear button is being clicked
  setTimeout(() => (open.value = false), 120)
}
</script>

<template>
  <div class="relative flex shrink-0 items-center">
    <Tooltip v-if="!query">
      <TooltipTrigger as-child>
        <Button variant="outline" size="icon-sm" :aria-label="props.placeholder" :class="open && 'invisible'" @click="expand"><PhMagnifyingGlass /></Button>
      </TooltipTrigger>
      <TooltipContent>{{ props.placeholder }}</TooltipContent>
    </Tooltip>
    <Button
      v-else
      variant="outline"
      size="sm"
      :class="cn('max-w-40 border-primary/40 bg-primary/10 text-primary hover:bg-primary/15', open && 'invisible')"
      :title="`Search: ${query}`"
      @click="expand"
    >
      <PhMagnifyingGlass /><span class="truncate">{{ query }}</span>
    </Button>
    <div v-if="open" class="absolute top-1/2 right-0 z-30 -translate-y-1/2 shadow-lg" :style="{ width: props.width }">
      <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
      <Input ref="input" v-model="query" type="search" :placeholder="props.placeholder" class="h-8 bg-background pr-8 pl-8" @keydown="onKeydown" @blur="onBlur" />
      <Button v-if="query" variant="ghost" size="icon-xs" class="absolute top-1/2 right-1 -translate-y-1/2" aria-label="Clear the search" @mousedown.prevent @click="query = ''"><PhX /></Button>
    </div>
  </div>
</template>
