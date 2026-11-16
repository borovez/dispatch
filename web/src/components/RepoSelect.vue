<script setup lang="ts">
import { computed } from 'vue'
import { PhGitBranch } from '@phosphor-icons/vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** One repo at a time, or "All repos" (dependency and release graphs). Counts sit on the right. */
const props = defineProps<{ tabs: { key: string; repo: string; count: number }[] }>()
const model = defineModel<string>({ required: true })
const picked = computed(() => props.tabs.find((t) => t.key === model.value) ?? null)

const name = (repo: string) => repo.split('/')[1] ?? repo
/** Item text fills the row so the count sits on the right; the picked repo is tinted primary */
const ITEM = 'min-w-48 rounded-none [&>span:last-child]:flex-1 data-[state=checked]:bg-primary/10 data-[state=checked]:font-medium data-[state=checked]:text-primary data-[state=checked]:[&_svg]:text-primary'
const COUNT = 'ml-auto rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground tabular-nums'
</script>

<template>
  <Select :model-value="model" @update:model-value="(r) => (model = String(r))">
    <SelectTrigger size="sm" class="w-56 max-w-full shrink" aria-label="Repository">
      <PhGitBranch class="text-muted-foreground" />
      <SelectValue class="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span class="truncate">{{ picked ? name(picked.repo) : 'All repos' }}</span>
        <span v-if="picked" :class="COUNT">{{ picked.count }}</span>
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="r in tabs" :key="r.key" :value="r.key" :title="r.repo" :class="ITEM">
        <span class="truncate">{{ name(r.repo) }}</span>
        <span :class="COUNT">{{ r.count }}</span>
      </SelectItem>
      <SelectItem value="all" :class="ITEM">All repos</SelectItem>
    </SelectContent>
  </Select>
</template>
