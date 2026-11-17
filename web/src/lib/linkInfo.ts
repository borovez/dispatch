import type { Component } from 'vue'
import {
  PhFile,
  PhFolder,
  PhGitCommit,
  PhGitDiff,
  PhGithubLogo,
  PhGitPullRequest,
  PhFlag,
  PhKanban,
  PhPlay,
  PhSlackLogo,
  PhTag,
  PhCircleDashed,
  PhGlobe,
} from '@phosphor-icons/vue'
import type { FeatureFlag, JiraIssue, PrView, SlackItem } from '@shared/types'
import type { StatusTone } from '@/composables/prStatus'
import type { useDeck } from '@/stores/deck'

/**
 * What a URL is, worked out from the URL itself and what Dispatch already has (no request): the link
 * hover card shows this at once and fills in the rest from `GET /api/link-preview`.
 */
export interface LinkInfo {
  /** "Pull request", "File", "Jira issue", "Web page"… */
  kind: string
  icon: Component
  site: string
  title?: string
  /** Short facts: "on main", "lines 10–20", "by octocat" */
  facts: string[]
  badge?: { tone: StatusTone; label: string }
  /** Dispatch has this item: the card offers to open it in a side panel */
  open?: { kind: 'pr' | 'jira' | 'slack'; id: string }
  pr?: PrView
  jira?: JiraIssue
  slack?: SlackItem
  flag?: FeatureFlag
  /** Everything worth showing is already here: skip the server lookup */
  complete?: boolean
}

type Deck = ReturnType<typeof useDeck>

export function describeLink(href: string, deck: Deck): LinkInfo {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return { kind: 'Link', icon: PhGlobe, site: '', facts: [] }
  }
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'github.com') return github(u, deck)
  if (host.endsWith('.atlassian.net')) return jira(u, deck)
  if (host === 'slack.com' || host.endsWith('.slack.com')) return slack(u, deck)
  if (host.endsWith('launchdarkly.com')) return launchDarkly(u, deck)
  return { kind: 'Web page', icon: PhGlobe, site: host, facts: [] }
}

function github(u: URL, deck: Deck): LinkInfo {
  const [owner, repo, kind, ...rest] = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const base = { site: 'GitHub', facts: [] as string[] }
  if (!owner) return { ...base, kind: 'GitHub', icon: PhGithubLogo }
  if (!repo) return { ...base, kind: 'GitHub profile', icon: PhGithubLogo, title: owner }
  const full = `${owner}/${repo}`
  const lines = u.hash.match(/^#L(\d+)(?:-L(\d+))?/)
  const lineFact = lines ? (lines[2] ? `lines ${lines[1]}–${lines[2]}` : `line ${lines[1]}`) : null
  switch (kind) {
    case 'pull': {
      const n = Number(rest[0])
      const pr = deck.prs.find((p) => p.number === n && p.repo.toLowerCase() === full.toLowerCase())
      const tab = rest[1] === 'files' ? 'files changed' : rest[1] === 'commits' ? 'commits' : rest[1] === 'checks' ? 'checks' : null
      const facts = [`${full}#${n}`, ...(tab ? [tab] : [])]
      if (pr) facts.push(`by ${pr.author.login}`)
      return { ...base, kind: 'Pull request', icon: PhGitPullRequest, title: pr?.title, facts, pr, open: pr ? { kind: 'pr', id: pr.id } : undefined, complete: !!pr }
    }
    case 'issues':
      return rest[0] ? { ...base, kind: 'GitHub issue', icon: PhCircleDashed, facts: [`${full}#${rest[0]}`] } : { ...base, kind: 'Issues', icon: PhCircleDashed, title: full }
    case 'commit':
    case 'commits':
      return { ...base, kind: kind === 'commit' ? 'Commit' : 'Commits', icon: PhGitCommit, title: full, facts: rest[0] ? [kind === 'commit' ? rest[0].slice(0, 7) : `on ${rest.join('/')}`] : [] }
    case 'blob':
    case 'tree': {
      // The branch may contain slashes; GitHub's own URL can't tell them apart either, so take the first part
      const [ref, ...path] = rest
      return {
        ...base,
        kind: kind === 'blob' ? 'File' : 'Folder',
        icon: kind === 'blob' ? PhFile : PhFolder,
        title: path.length ? path.join('/') : full,
        facts: [full, ...(ref ? [`on ${ref.length === 40 ? ref.slice(0, 7) : ref}`] : []), ...(lineFact ? [lineFact] : [])],
      }
    }
    case 'compare':
      return { ...base, kind: 'Comparison', icon: PhGitDiff, title: full, facts: [rest.join('/').replace('...', ' → ')] }
    case 'releases':
      return { ...base, kind: 'Release', icon: PhTag, title: full, facts: rest[0] === 'tag' && rest[1] ? [rest[1]] : [] }
    case 'actions':
      return { ...base, kind: 'GitHub Actions', icon: PhPlay, title: full, facts: rest[0] === 'runs' && rest[1] ? [`run ${rest[1]}`] : [] }
    default:
      return { ...base, kind: 'Repository', icon: PhGithubLogo, title: full }
  }
}

const JIRA_TONE: Record<string, StatusTone> = { done: 'success', indeterminate: 'info', new: 'muted' }

function jira(u: URL, deck: Deck): LinkInfo {
  const key = (u.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i)?.[1] ?? u.searchParams.get('selectedIssue'))?.toUpperCase()
  if (!key) return { kind: 'Jira', icon: PhKanban, site: 'Jira', facts: [] }
  const issue = deck.jiraByKey.get(key)
  return {
    kind: issue ? issue.type : 'Jira issue',
    icon: PhKanban,
    site: 'Jira',
    title: issue?.summary,
    facts: [issue?.key ?? key, ...(issue?.assignee ? [issue.assignee.displayName] : [])],
    badge: issue ? { tone: JIRA_TONE[issue.statusCategory] ?? 'muted', label: issue.status } : undefined,
    jira: issue,
    open: { kind: 'jira', id: issue?.key ?? key },
    complete: !!issue,
  }
}

function slack(u: URL, deck: Deck): LinkInfo {
  const m = u.pathname.match(/\/archives\/([A-Z0-9]+)(?:\/p(\d{10})(\d{6}))?/)
  if (!m) return { kind: 'Slack', icon: PhSlackLogo, site: 'Slack', facts: [], complete: true }
  const item = deck.overview?.slack.find((s) => s.permalink && s.permalink.split('?')[0] === u.href.split('?')[0])
  const facts: string[] = []
  if (item) facts.push(item.userName, item.channelName)
  else if (m[2]) facts.push(new Date(Number(m[2]) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))
  return {
    kind: m[2] ? 'Slack message' : 'Slack channel',
    icon: PhSlackLogo,
    site: 'Slack',
    title: item ? item.text.replace(/\s+/g, ' ').slice(0, 160) : undefined,
    facts,
    slack: item,
    open: item ? { kind: 'slack', id: item.id } : undefined,
    complete: true,
  }
}

function launchDarkly(u: URL, deck: Deck): LinkInfo {
  const key = u.pathname.match(/\/features\/([^/]+)/)?.[1]
  const flag = key ? deck.flagByKey.get(decodeURIComponent(key)) : undefined
  return {
    kind: key ? 'Feature flag' : 'LaunchDarkly',
    icon: PhFlag,
    site: 'LaunchDarkly',
    title: flag?.name ?? key,
    facts: key && flag?.name !== key ? [key] : [],
    flag,
    complete: true,
  }
}
