<script setup lang="ts">
import { computed } from 'vue'
import { ITEM_KIND, type ItemKind } from '@/utils/itemKinds'
import { cn } from '@/lib/utils'

/** Tinted icon saying what an item is (pull request, Jira issue, Slack message), e.g. before a panel's title */
const props = defineProps<{ kind: ItemKind; class?: string }>()
const k = computed(() => ITEM_KIND[props.kind])
</script>

<template>
  <span :class="cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md', k.tone, props.class)" :title="k.label" role="img" :aria-label="k.label">
    <component :is="k.icon" :size="14" weight="bold" />
  </span>
</template>
