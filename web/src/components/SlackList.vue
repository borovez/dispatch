<script setup lang="ts">
import { computed } from 'vue'
import type { SlackItem } from '@shared/types'
import { dateGroup } from '@/utils/format'
import { cn } from '@/lib/utils'
import SlackRow from './SlackRow.vue'
import { PhPushPin } from '@phosphor-icons/vue'

/**
 * Slack items grouped under date headings (Today, Yesterday, This week, Last week, then month), in
 * the order given; pinned ones first, under Pinned. `sticky` pins each heading under the app header while its group is on
 * screen; nothing between the list and the scroll area may clip (no overflow-hidden).
 */
const props = defineProps<{ items: SlackItem[]; sticky?: boolean }>()

const groups = computed(() => {
  const pinned = props.items.filter((i) => i.pinned)
  const out: { label: string; items: SlackItem[] }[] = pinned.length ? [{ label: 'Pinned', items: pinned }] : []
  for (const i of props.items) {
    if (i.pinned) continue
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
        <PhPushPin v-if="g.label === 'Pinned'" :size="12" weight="fill" class="-mt-0.5 mr-0.5 inline text-primary" />{{ g.label }} <span class="font-normal">· {{ g.items.length }}</span>
      </h3>
      <div class="p-1.5">
        <SlackRow v-for="i in g.items" :key="i.id" :item="i" />
      </div>
    </section>
  </div>
</template>
