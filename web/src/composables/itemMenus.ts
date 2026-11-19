import type { Component } from 'vue'
import { toast } from 'vue-sonner'
import { writeClipboard } from '@/lib/clipboard'
import {
  PhArrowSquareOut,
  PhArrowsClockwise,
  PhCheckCircle,
  PhCopy,
  PhGraph,
  PhGitPullRequest,
  PhMagicWand,
  PhNotePencil,
  PhPencilSimple,
  PhPushPin,
  PhPushPinSlash,
  PhRobot,
  PhRocketLaunch,
  PhSidebarSimple,
  PhSwap,
  PhTrash,
  PhArrowCounterClockwise,
  PhCheck,
  PhKanban,
  PhX,
} from '@phosphor-icons/vue'
import type { DepEdge, JiraIssueView, PrView, SlackItem } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useReleaseNav } from '@/composables/releaseNav'
import { transitionsFor } from '@/composables/jiraTransitions'
import { usePrState } from '@/composables/prState'

/**
 * Right-click menus for list items (ItemContextMenu). Each item type has one definition, so a row's
 * menu and any other place that offers the same actions can't drift apart.
 */
export interface MenuAction {
  label: string
  icon?: Component
  /** Muted text on the right (a key, a shortcut) */
  hint?: string
  run?: () => unknown
  /** Opens in a new tab */
  href?: string
  variant?: 'destructive'
  disabled?: boolean
  /** A submenu: the entries, or a loader for ones that need a request (Jira statuses) */
  children?: MenuEntry[] | (() => Promise<MenuEntry[]>)
}
export type MenuEntry = MenuAction | 'separator' | { heading: string }

export async function copyText(text: string, what: string) {
  try {
    await writeClipboard(text)
    toast.success(`Copied ${what}`)
  } catch {
    toast.error(`Couldn't copy the ${what}`)
  }
}

/** The Slack conversation around an item as a Markdown brief for any AI chat (at least 20 messages either side) */
export async function copySlackPrompt(item: SlackItem, before = 20, after = 20) {
  const id = toast.loading('Collecting the conversation…')
  try {
    const { prompt } = await api.slackPrompt(item.id, Math.max(20, before), Math.max(20, after))
    await writeClipboard(prompt)
    toast.success('Copied the conversation as an AI prompt', { id })
  } catch (e) {
    toast.error(`Couldn't copy the conversation: ${(e as Error).message}`, { id })
  }
}

/** A Jira issue pre-filled from a PR: its title without Jira keys or a conventional-commit prefix, and a link back */
export function issueSeedFromPr(p: PrView) {
  const summary = p.title.replace(/\s*\[[A-Z][A-Z0-9_]+-\d+\]/g, '').replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim()
  return { mode: 'create' as const, summary: summary.charAt(0).toUpperCase() + summary.slice(1), description: `Pull request: [${p.id}](${p.url})`, prId: p.id }
}

/** Branch name for a Jira issue: KEY-short-summary */
export function branchFor(key: string, summary?: string) {
  const slug = (summary ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
  return slug ? `${key}-${slug}` : key
}

/**
 * "Open details" for an item: left out when the side panel already shows it, and "Open in panel" while a
 * panel is open (it switches the panel to that item)
 */
function openEntry(deck: ReturnType<typeof useDeck>, shown: boolean, open: () => void): MenuEntry[] {
  if (shown) return []
  const panelOpen = !!(deck.selectedId || deck.selectedJiraKey || deck.selectedSlackId)
  return [{ label: panelOpen ? 'Open in panel' : 'Open details', icon: PhSidebarSimple, run: open }]
}

/** Remove a dependency (the PR panel's Dependencies list) */
export function removeDependencyEntry(e: DepEdge, remove: (e: DepEdge) => unknown, busy: boolean): MenuEntry {
  return { label: e.id != null ? 'Remove dependency' : 'Remove from the PR description', icon: PhTrash, variant: 'destructive', disabled: busy, run: () => remove(e) }
}

export function usePrMenu() {
  const deck = useDeck()
  const nav = useReleaseNav()
  const prState = usePrState()
  /** A PR by id: its full menu when it's synced, else GitHub and copy only. `extra` goes at the end. */
  const byId = (id: string, extra: MenuEntry[] = []): MenuEntry[] => {
    const pr = deck.byId.get(id)
    if (pr) return menu(pr, extra)
    const [repo, n] = id.split('#')
    const url = `https://github.com/${repo}/pull/${n}`
    return [
      { label: 'Open on GitHub', icon: PhArrowSquareOut, href: url },
      'separator',
      { label: 'Copy link', icon: PhCopy, run: () => copyText(url, 'link') },
      ...(extra.length ? (['separator', ...extra] as MenuEntry[]) : []),
    ]
  }
  const menu = (pr: PrView, extra: MenuEntry[] = []): MenuEntry[] => {
    const ref = `${pr.repo}#${pr.number}`
    const release = nav.releaseForPr(pr.id)
    const jira = pr.jiraKeys.map((k) => ({ key: k, issue: deck.jiraByKey.get(k) }))
    return [
      ...openEntry(deck, deck.selectedId === pr.id, () => (deck.selectedId = pr.id)),
      { label: 'Open on GitHub', icon: PhArrowSquareOut, href: pr.url },
      'separator',
      {
        label: 'Copy',
        icon: PhCopy,
        children: [
          { label: 'Link', run: () => copyText(pr.url, 'link') },
          { label: ref, run: () => copyText(ref, 'reference') },
          { label: 'Branch name', hint: pr.headRef, run: () => copyText(pr.headRef, 'branch name') },
          { label: 'Title', run: () => copyText(pr.title, 'title') },
          { label: 'Markdown link', run: () => copyText(`[${ref}: ${pr.title}](${pr.url})`, 'Markdown link') },
        ],
      },
      'separator',
      {
        label: pr.pinned ? 'Unpin' : 'Pin to top',
        icon: pr.pinned ? PhPushPinSlash : PhPushPin,
        run: () => deck.mutate(() => api.setMeta(pr.id, pr.note, !pr.pinned)),
      },
      // Dismiss what the PR asks for (e.g. a backmerge that isn't needed), with a confirmation; or undo that
      ...(pr.markedDone
        ? [{ label: `Undo mark as done (${pr.markedDone.label})`, icon: PhArrowCounterClockwise, run: () => deck.mutate(() => api.setDone(pr.id, null), `${ref}: ${pr.markedDone!.label} again`) }]
        : pr.action.kind !== 'done' && pr.action.kind !== 'none'
          ? [{ label: 'Mark as done…', icon: PhCheckCircle, hint: pr.action.label, run: () => (deck.markDonePr = pr.id) }]
          : []),
      // Ready for review / back to draft / close / reopen on GitHub
      ...(prState.options(pr).length
        ? [
            {
              label: 'State',
              icon: PhGitPullRequest,
              hint: pr.state === 'OPEN' ? (pr.isDraft ? 'Draft' : 'Open') : pr.state === 'CLOSED' ? 'Closed' : undefined,
              children: prState.options(pr).map((o) => ({ label: o.label, icon: o.icon, run: () => prState.change(pr, o.to) })),
            },
          ]
        : []),
      { label: 'Resync from GitHub', icon: PhArrowsClockwise, run: () => deck.mutate(() => api.resyncPr(pr.id), `Resynced ${ref}`) },
      ...(pr.state === 'OPEN' ? [{ label: 'Edit title and description…', icon: PhMagicWand, run: () => (deck.prWriter = pr.id) }] : []),
      ...(deck.overview?.configured.jira ? [{ label: 'Create Jira issue…', icon: PhNotePencil, run: () => (deck.composer = issueSeedFromPr(pr)) }] : []),
      ...(jira.length
        ? ([
            'separator',
            ...(jira.length === 1
              ? [{ label: `Open ${jira[0].key}`, hint: jira[0].issue?.status, icon: PhSidebarSimple, run: () => (deck.selectedJiraKey = jira[0].key) }]
              : [
                  {
                    label: 'Jira issues',
                    icon: PhSidebarSimple,
                    children: jira.map((j) => ({ label: j.key, hint: j.issue?.status, run: () => (deck.selectedJiraKey = j.key) })),
                  },
                ]),
          ] as MenuEntry[])
        : []),
      ...(nav.hasDeps(pr.id)
        ? ([{ label: 'Show in the dependency graph', icon: PhGraph, run: () => nav.openDependencies([pr.id]) }] as MenuEntry[])
        : []),
      ...(release
        ? ([
            'separator',
            { label: release === pr.id ? 'Open on the Releases page' : 'Open the release that ships this', icon: PhRocketLaunch, run: () => nav.openReleases(release, deck.byId.get(release)?.flow === 'hotfix' ? 'hotfixes' : 'releases') },
            { label: 'Show in the release graph', icon: PhGraph, run: () => nav.openGraph(pr.id, pr.repo) },
          ] as MenuEntry[])
        : []),
      ...(extra.length ? (['separator', ...extra] as MenuEntry[]) : []),
    ]
  }
  return Object.assign(menu, { byId })
}

export function useJiraMenu() {
  const deck = useDeck()
  return (key: string, issue: JiraIssueView | null, prs: PrView[] = []): MenuEntry[] => {
    const url = issue?.url ?? (deck.overview?.jiraBaseUrl ? `${deck.overview.jiraBaseUrl}/browse/${key}` : undefined)
    const connected = !!deck.overview?.configured.jira
    return [
      ...openEntry(deck, deck.selectedJiraKey === key, () => (deck.selectedJiraKey = key)),
      ...(url
        ? [
            { label: 'Open in Jira', icon: PhArrowSquareOut, href: url },
          ]
        : []),
      'separator',
      ...(connected && issue
        ? [
            {
              label: 'Status',
              icon: PhSwap,
              hint: issue.status,
              children: async () => {
                const list = await transitionsFor(key, issue)
                if (!list.length) return [{ heading: 'No transitions' }] as MenuEntry[]
                return list.map((t) => ({ label: t.name === t.to ? t.to : `${t.name} → ${t.to}`, run: () => deck.mutate(() => api.transition(key, t.id), `${key} → ${t.to}`) }))
              },
            },
            { label: 'Edit…', icon: PhPencilSimple, run: () => (deck.composer = { mode: 'edit', key }) },
          ]
        : []),
      { label: 'Prompt for an AI agent…', icon: PhRobot, run: () => (deck.agentPromptKey = key) },
      ...(connected ? [{ label: 'Reload from Jira', icon: PhArrowsClockwise, run: () => deck.mutate(() => api.jiraRefresh(key), `Reloaded ${key}`) }] : []),
      'separator',
      {
        label: 'Copy',
        icon: PhCopy,
        children: [
          { label: 'Key', hint: key, run: () => copyText(key, 'key') },
          ...(url ? [{ label: 'Link', run: () => copyText(url, 'link') }] : []),
          ...(issue ? [{ label: 'Key and summary', run: () => copyText(`${key}: ${issue.summary}`, 'key and summary') }] : []),
          { label: 'Branch name', hint: branchFor(key, issue?.summary), run: () => copyText(branchFor(key, issue?.summary), 'branch name') },
        ],
      },
      ...(prs.length
        ? ([
            'separator',
            {
              label: 'Pull requests',
              icon: PhGitPullRequest,
              hint: String(prs.length),
              children: prs.map((p) => ({ label: p.title, hint: `#${p.number}`, run: () => (deck.selectedId = p.id) })),
            },
          ] as MenuEntry[])
        : []),
    ]
  }
}

/** Done / dismiss / back to inbox for a Slack item, with the toast saying what changed in Slack too */
export async function setSlackStatus(deck: ReturnType<typeof useDeck>, item: SlackItem, s: SlackItem['status']): Promise<boolean> {
  let res: Awaited<ReturnType<typeof api.slackStatus>> | undefined
  const ok = await deck.mutate(async () => void (res = await api.slackStatus(item.id, s)))
  if (!ok) return false
  const label = s === 'done' ? 'Marked done' : s === 'dismissed' ? 'Dismissed' : 'Back in inbox'
  // Todos also change in Slack (done reaction added / removed)
  if (res?.slack) toast.success(label, { description: res.slack.done ? `Added :${res.slack.reaction}: in Slack` : `Removed :${res.slack.reaction}: in Slack` })
  else if (res?.warning) toast.warning(`${label} in Dispatch only`, { description: res.warning })
  else toast.success(label)
  return true
}

/** Pin / unpin a Slack message: pinned ones stay at the top of the inbox until unpinned */
export async function toggleSlackPin(deck: ReturnType<typeof useDeck>, item: SlackItem): Promise<boolean> {
  return deck.mutate(() => api.slackPin(item.id, !item.pinned), item.pinned ? 'Unpinned' : 'Pinned to the top of the inbox')
}

/** New Jira issue with a Slack message as context: Claude reads the thread; creating it marks the message done */
export function slackToJira(deck: ReturnType<typeof useDeck>, item: SlackItem) {
  deck.composer = {
    mode: 'create',
    slackItemId: item.id,
    description: item.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n'),
  }
}

export function useSlackMenu() {
  const deck = useDeck()
  return (item: SlackItem): MenuEntry[] => {
    const open = item.status === 'new'
    const quote = item.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    return [
      ...openEntry(deck, deck.selectedSlackId === item.id, () => (deck.selectedSlackId = item.id)),
      ...(item.permalink ? [{ label: 'Open in Slack', icon: PhArrowSquareOut, href: item.permalink }] : []),
      'separator',
      item.jiraKey
        ? { label: `Open ${item.jiraKey}`, icon: PhSidebarSimple, run: () => (deck.selectedJiraKey = item.jiraKey) }
        : { label: 'Create Jira task…', icon: PhKanban, run: () => slackToJira(deck, item) },
      ...(open
        ? [
            { label: 'Done', icon: PhCheck, run: () => setSlackStatus(deck, item, 'done') },
            { label: 'Dismiss', icon: PhX, run: () => setSlackStatus(deck, item, 'dismissed') },
          ]
        : [{ label: 'Back to inbox', icon: PhArrowCounterClockwise, run: () => setSlackStatus(deck, item, 'new') }]),
      { label: item.pinned ? 'Unpin' : 'Pin to top', icon: item.pinned ? PhPushPinSlash : PhPushPin, run: () => toggleSlackPin(deck, item) },
      'separator',
      {
        label: 'Copy',
        icon: PhCopy,
        children: [
          ...(item.permalink ? [{ label: 'Link', run: () => copyText(item.permalink!, 'link') }] : []),
          { label: 'Text', run: () => copyText(item.text, 'message') },
          { label: 'As a quote', hint: `${item.userName}`, run: () => copyText(`${quote}\n— ${item.userName}`, 'quote') },
          { label: 'Conversation for AI', icon: PhRobot, hint: 'Markdown', run: () => copySlackPrompt(item) },
        ],
      },
    ]
  }
}
