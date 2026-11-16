import { PhGitPullRequest, PhKanban, PhSlackLogo } from '@phosphor-icons/vue'
import type { PanelRef } from '@/stores/deck'

/**
 * How each kind of item is marked in side panels (top bar, history tooltips): the same icons as the
 * sidebar's pages, each with its own tint (theme tokens only).
 */
export const ITEM_KIND = {
  pr: { icon: PhGitPullRequest, label: 'Pull request', tone: 'bg-success/12 text-success' },
  jira: { icon: PhKanban, label: 'Jira issue', tone: 'bg-info/12 text-info' },
  slack: { icon: PhSlackLogo, label: 'Slack message', tone: 'bg-merged/12 text-merged' },
} as const satisfies Record<PanelRef['kind'], { icon: unknown; label: string; tone: string }>

export type ItemKind = keyof typeof ITEM_KIND
