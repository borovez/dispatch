/**
 * Links that leave Dispatch (GitHub, Jira, Slack, LaunchDarkly…) versus ones that open in the app.
 * Rule: a plain click opens in Dispatch (a side panel); Cmd/Ctrl-click opens the outside site.
 * Links that only go outside use `ExternalLink` (↗ icon, tooltip naming the site).
 */

/** Running in the Mac app: external links open in the default browser, not a new tab */
export const inDesktopApp = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)

/** "GitHub", "Jira", "Slack", "LaunchDarkly", else the host */
export function siteName(url: string | null | undefined): string {
  if (!url) return 'the site'
  if (url.startsWith('slack:')) return 'Slack'
  let host: string
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'the site'
  }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'GitHub'
  if (host.endsWith('.atlassian.net')) return 'Jira'
  if (host === 'slack.com' || host.endsWith('.slack.com')) return 'Slack'
  if (host.endsWith('launchdarkly.com')) return 'LaunchDarkly'
  return host
}

/** "Opens GitHub in a new tab" (in the Mac app: "in your browser") */
export function externalHint(url: string | null | undefined, site = siteName(url)): string {
  return `Opens ${site} ${inDesktopApp ? 'in your browser' : 'in a new tab'} ↗`
}

/** Cmd/Ctrl-click (or middle click): the user wants the outside site */
export const wantsExternal = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.button === 1

export function openExternal(url: string | null | undefined) {
  if (url) window.open(url, '_blank', 'noopener')
}

/**
 * Click handler for an item that opens in Dispatch: Cmd/Ctrl-click opens `url` outside instead.
 * Returns true when it went outside.
 */
export function openInAppOr(e: MouseEvent, url: string | null | undefined, inApp: () => void): boolean {
  if (url && wantsExternal(e)) {
    openExternal(url)
    return true
  }
  inApp()
  return false
}

/** Tooltip suffix for in-app items: "⌘-click opens GitHub" */
export const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
export const modClickHint = (url: string | null | undefined) => (url ? `${modKey}-click opens ${siteName(url)}` : '')
