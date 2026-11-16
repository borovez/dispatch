<script setup lang="ts">
import { computed } from 'vue'
import type { SlackItem } from '@shared/types'
import { dateGroup } from '@/utils/format'
import { cn } from '@/lib/utils'
import SlackRow from './SlackRow.vue'

/**
 * Slack items grouped under date headings (Today, Yesterday, This week, Last week, then month), in
 * the order given. `sticky` pins each heading under the app header while its group is on
 * screen; nothing between the list and the scroll area may clip (no overflow-hidden).
 */
const props = defineProps<{ items: SlackItem[]; sticky?: boolean }>()

const groups = computed(() => {
  const out: { label: string; items: SlackItem[] }[] = []
  for (const i of props.items) {
    const label = dateGroup(i.postedAt)
    if (out.at(-1)?.label === label) out.at(-1)!.items.push(i)
    else out.push({ label, items: [i] })
  }
  return out
})
</script>

<template>
  <div>
    <section v-for="(g, gi) in groups" :key="g.label">
      <h3
        :class="cn(
          'border-b bg-muted/90 px-4 py-1.5 text-xs font-semibold text-muted-foreground',
          sticky && 'sticky top-(--sticky-top,--spacing(14)) z-10 backdrop-blur',
          gi > 0 && 'border-t',
        )"
      >
        {{ g.label }} <span class="font-normal">· {{ g.items.length }}</span>
      </h3>
      <div class="p-1.5">
        <SlackRow v-for="i in g.items" :key="i.id" :item="i" />
      </div>
    </section>
  </div>
</template>
