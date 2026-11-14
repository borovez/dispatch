import type { Component } from 'vue'
import { toast } from 'vue-sonner'
import {
  PhArrowSquareOut,
  PhArrowsClockwise,
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
  PhSquareSplitHorizontal,
  PhSwap,
  PhTrash,
} from '@phosphor-icons/vue'
import type { DepEdge, JiraIssueView, PrView } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useReleaseNav } from '@/composables/releaseNav'
import { openBeside } from '@/composables/besideWindow'
import { transitionsFor } from '@/composables/jiraTransitions'

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
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${what}`)
  } catch {
    toast.error(`Couldn't copy the ${what}`)
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
  /** A PR by id: its full menu when it's synced, else GitHub and copy only. `extra` goes at the end. */
  const byId = (id: string, extra: MenuEntry[] = []): MenuEntry[] => {
    const pr = deck.byId.get(id)
    if (pr) return menu(pr, extra)
    const [repo, n] = id.split('#')
    const url = `https://github.com/${repo}/pull/${n}`
    return [
      { label: 'Open on GitHub', icon: PhArrowSquareOut, href: url },
      { label: 'Open beside', icon: PhSquareSplitHorizontal, run: () => openBeside(url) },
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
      { label: 'Open beside', icon: PhSquareSplitHorizontal, run: () => openBeside(pr.url) },
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
            { label: 'Open beside', icon: PhSquareSplitHorizontal, run: () => openBeside(url) },
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
