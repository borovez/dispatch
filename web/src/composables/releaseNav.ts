import { useRouter } from 'vue-router'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'

/**
 * Jump from a panel to the Releases page or the release graph, focused on a release / PR
 * (the page reads ?focus=<pr id>: expands, scrolls and highlights; the graph zooms to the box).
 */
export function useReleaseNav() {
  const router = useRouter()
  const deck = useDeck()
  const layout = useLayout()
  const releases = layout.view('releases', { tab: 'releases' as string, mode: 'list' as string })
  const graph = layout.view('releaseGraph', { repo: '' as string })

  function openReleases(focus: string, tab: 'releases' | 'hotfixes' = 'releases') {
    releases.tab = tab
    releases.mode = 'list'
    // Don't let the repo filter hide what's being shown
    const repo = deck.byId.get(focus)?.repo.toLowerCase()
    if (graph.repo && graph.repo !== 'all' && repo && graph.repo !== repo) graph.repo = ''
    router.push({ path: '/releases', query: { focus } })
  }
  function openGraph(focus: string, repo: string) {
    // The graph shows the tab's kind of items: hotfixes on Hotfixes, everything else on Releases
    releases.tab = deck.byId.get(focus)?.flow === 'hotfix' ? 'hotfixes' : 'releases'
    releases.mode = 'graph'
    graph.repo = repo.toLowerCase()
    // The panel stays open: the graph zooms to the box in the part the panel doesn't cover
    router.push({ path: '/releases', query: { focus } })
  }
  const depGraph = layout.view('graph', { org: '', repo: '', hideDone: true, mineOnly: false })
  /**
   * The dependency graph focused on these PRs: their chains are highlighted and framed. Filters that would
   * hide them are relaxed (repo: theirs when they share one, else all; finished chains shown when needed).
   */
  function openDependencies(ids: string[]) {
    if (!ids.length) return
    const repos = [...new Set(ids.map((id) => (deck.byId.get(id)?.repo ?? id.split('#')[0]).toLowerCase()))]
    depGraph.repo = repos.length === 1 ? repos[0] : ''
    if (depGraph.org && ids.some((id) => id.split('/')[0] !== depGraph.org)) depGraph.org = ''
    depGraph.mineOnly = false
    if ((deck.overview?.chains ?? []).some((c) => c.done && c.prs.some((id) => ids.includes(id)))) depGraph.hideDone = false
    // The panel stays open; the graph frames the chains in the part it doesn't cover
    router.push({ path: '/graph', query: { focus: ids.join(',') } })
  }
  /** PRs with at least one dependency either way */
  const hasDeps = (id: string) => (deck.overview?.edges ?? []).some((e) => e.from === id || e.to === id)

  function openTrains() {
    releases.tab = 'trains'
    router.push('/releases')
  }

  /** The release that ships a Jira issue: open ones first */
  function releaseForIssue(key: string): string | null {
    const prs = deck.prs.filter((p) => p.jiraKeys.includes(key))
    const own = prs.find((p) => p.flow === 'release' && p.state === 'OPEN') ?? prs.find((p) => p.flow === 'release')
    if (own) return own.id
    const shipped = prs.flatMap((p) => p.shipsIn).sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN'))[0]
    if (shipped) return shipped.id
    const byContents = (deck.overview?.releases ?? [])
      .filter((r) => r.jiraKeys.includes(key))
      .sort((a, b) => Number(deck.byId.get(b.prId)?.state === 'OPEN') - Number(deck.byId.get(a.prId)?.state === 'OPEN'))[0]
    return byContents?.prId ?? null
  }

  /** A release / hotfix PR itself, or the release that ships the PR (open ones first) */
  function releaseForPr(id: string): string | null {
    const p = deck.byId.get(id)
    if (!p) return null
    if (p.flow === 'release' || p.flow === 'hotfix') return p.id
    return [...p.shipsIn].sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN'))[0]?.id ?? null
  }

  /** From free text (e.g. a Slack message): GitHub PR links first, then Jira keys */
  function releaseForText(text: string, extraKeys: string[] = []): string | null {
    for (const m of text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi)) {
      const r = releaseForPr(`${m[1]}/${m[2]}#${m[3]}`.toLowerCase())
      if (r) return r
    }
    const keys = [...extraKeys, ...[...text.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => m[1])]
    for (const k of keys) {
      const r = releaseForIssue(k)
      if (r) return r
    }
    return null
  }

  return { openReleases, openGraph, openDependencies, hasDeps, openTrains, releaseForIssue, releaseForPr, releaseForText }
}
