import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { SLACK_USER_SCOPES } from '../../shared/types.ts'
import { claudeBin } from './claudeCode.ts'
import { DB_PATH, getSettings, listPrs } from './db.ts'
import { VERSION } from './updates.ts'

/** Whether a CLI is installed, and the first line it prints (e.g. `gh auth status`) */
async function probe(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(cmd, args, { timeout: 5000 })
    return { ok: true, out: `${stdout}\n${stderr}`.trim() }
  } catch (e) {
    const err = e as { code?: string; stdout?: string; stderr?: string }
    return { ok: false, out: err.code === 'ENOENT' ? 'not installed' : `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() }
  }
}

/** A Slack app manifest with the user scopes Dispatch uses (paste into api.slack.com → Create app → From a manifest) */
function slackManifest(): string {
  return JSON.stringify(
    {
      display_information: { name: 'Dispatch', description: 'Personal PR, Jira and Slack dashboard (local)' },
      oauth_config: { scopes: { user: SLACK_USER_SCOPES } },
      settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
    },
    null,
    2,
  )
}

/**
 * A Markdown brief for an AI agent (Claude Code or any other) to walk the user through setting Dispatch
 * up: what's connected already (never any secret), what's missing, where each token comes from and which
 * scopes it needs, and the commands the agent may run. Tokens are always pasted by the user into Dispatch's
 * own Settings forms, never into the chat. No AI call.
 */
export async function buildSetupPrompt(origin: string): Promise<string> {
  const s = getSettings()
  const settingsUrl = `${origin}/settings`
  const [gh, claude] = await Promise.all([probe('gh', ['auth', 'status']), Promise.resolve(claudeBin())])
  const ghAccounts = s.github.accounts.filter((a) => a.token)
  const prCount = listPrs().length
  const done = (b: boolean) => (b ? '✅' : '⬜')
  const mcpEntry = fileURLToPath(new URL('./mcp.ts', import.meta.url))
  const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

  const status = [
    `- ${done(ghAccounts.length > 0)} **GitHub** (required): ${
      ghAccounts.length
        ? ghAccounts.map((a) => `${a.label} (${a.login ?? 'unknown login'}, ${a.source === 'gh-cli' ? 'gh CLI login' : 'token'}${a.orgs.length ? `, limited to ${a.orgs.join(', ')}` : ', all orgs'})`).join('; ')
        : 'not connected'
    }. Tracked repos (every open PR pulled in): ${s.trackedRepos.length ? s.trackedRepos.join(', ') : 'none'}. PRs synced: ${prCount}.`,
    `- ${done(!!s.jira?.apiToken)} **Jira** (optional): ${
      s.jira?.apiToken
        ? `${s.jira.baseUrl} as ${s.jira.email}; projects ${s.jira.projectKeys.join(', ') || 'any'}; "my issues" JQL ${s.jira.myJql ? `\`${s.jira.myJql}\`` : 'not set'}`
        : 'not connected'
    }.`,
    `- ${done(!!s.slack?.token)} **Slack** (optional): ${s.slack?.token ? `${s.slack.teamUrl ?? 'connected'}; todo reactions ${s.slack.todoReactions.map((r) => `:${r}:`).join(' ') || 'none'}` : 'not connected'}.`,
    `- ${done(!!s.launchdarkly?.apiToken)} **LaunchDarkly** (optional, read only): ${
      s.launchdarkly?.apiToken ? `project ${s.launchdarkly.projectKey}, environments ${s.launchdarkly.environments.join(', ') || 'none picked'}` : 'not connected'
    }.`,
    `- ${done(s.ai.provider === 'api' ? !!s.ai.apiKey : !!claude)} **Claude drafting** (optional): provider ${s.ai.provider === 'api' ? `Anthropic API (${s.ai.apiKey ? 'key set' : 'no key yet'})` : `Claude Code CLI (${claude ? `found at ${claude}` : 'the `claude` CLI was not found on the server PATH'})`}, model ${s.ai.model}.`,
    `- **Sync**: ${s.sync.auto ? `automatic every ${s.sync.intervalMinutes} min` : 'manual'}; merged PRs kept ${s.sync.mergedLookbackDays} days.`,
  ]

  const out = [
    '# Help me set up Dispatch',
    '',
    `Dispatch (v${VERSION}) is my personal, local-only dashboard for pull requests across GitHub orgs, their cross-repo dependencies, Jira issues and a Slack inbox. It runs on this machine at ${origin} (API under \`${origin}/api\`, SQLite at \`${DB_PATH}\`, secrets in the macOS Keychain). Please walk me through setting it up, one integration at a time, checking each works before moving on.`,
    '',
    '## Rules',
    '',
    `- **Never ask me to paste a token, password or API key into this chat**, and never read one from my browser, keychain or files. Tell me where to create it and which scopes it needs; I paste it into the matching form in Dispatch → Settings (${settingsUrl}), which tests it and stores it in the Keychain.`,
    '- **Change non-secret settings for me** rather than describing clicks: with the `dispatch` MCP server (step 6) use `setup_status`, `update_settings` (tracked repos, org limits, sync, Jira site / email / projects / JQL, Slack reactions, LaunchDarkly project and environments, Claude provider and model, release refs; only the fields given change) and `connect_github_gh_cli` (Dispatch reads the gh login itself). Without it, the same patch works over HTTP: `curl -s -X PATCH ' + origin + '/api/settings -H \'Content-Type: application/json\' -d \'{"sync":{"intervalMinutes":5}}\'` (returns what changed). Tokens and API keys can\'t be set either way.',
    '- You may run read-only checks and the commands listed below (e.g. `gh auth status`, `curl` against the local API). Ask before anything that changes my GitHub, Jira or Slack accounts.',
    `- To see progress, fetch this brief again: \`curl -s '${origin}/api/setup/prompt?text=1'\`. Its status list updates as things get connected.`,
    '- Keep each step short: what to click, what to paste where, how to tell it worked.',
    '',
    '## Where things stand',
    '',
    ...status,
    '',
    '## Steps',
    '',
    '### 1. GitHub (required)',
    '',
    'Two ways; the first is easiest:',
    '',
    `- **gh CLI login**: \`gh\` is ${gh.ok ? 'installed' : gh.out === 'not installed' ? 'not installed (`brew install gh`)' : 'installed but not logged in'}.${gh.ok ? '' : ' Run `gh auth login` (HTTPS, browser).'} It needs the \`repo\` and \`read:org\` scopes: \`gh auth refresh -s repo,read:org\`. Then Settings → GitHub → **Use my gh CLI login** (or the \`connect_github_gh_cli\` MCP tool).`,
    '- **Personal access token**: github.com → Settings → Developer settings → Personal access tokens. Classic: scopes `repo` and `read:org`. Fine-grained: the orgs\' repositories with Pull requests, Contents, Metadata (read) and Pull requests (write, to add dependency lines to descriptions and to mark PRs ready, draft, closed or reopened). For orgs with SAML SSO, click **Configure SSO → Authorize** for each org. Then Settings → GitHub → **Add token**.',
    '- Optionally limit an account to some orgs, and pick **Tracked repos** (every open PR in them, not only mine). Then press **Sync** in the header and check PRs appear.',
    '',
    '### 2. Jira (optional)',
    '',
    '- Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens.',
    '- Settings → Jira: site URL (`https://<company>.atlassian.net`), my Atlassian email, the token; **Test**; pick the projects whose keys count as Jira references; "my issues" JQL, e.g. `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`; default project and issue type for new issues.',
    '',
    '### 3. Slack (optional)',
    '',
    '- https://api.slack.com/apps → **Create New App → From a manifest** → my workspace, paste this manifest (user scopes only, nothing is posted as a bot):',
    '',
    '```json',
    slackManifest(),
    '```',
    '',
    '- **Install to Workspace** (an admin may need to approve), then copy the **User OAuth Token** (`xoxp-…`) from OAuth & Permissions into Settings → Slack and **Test**. Pick todo reactions (e.g. :eyes:) and done reactions.',
    '- The Slack CLI (`slack`) can also create or update the app from the manifest if it is installed and logged in.',
    '',
    '### 4. LaunchDarkly (optional, read only)',
    '',
    `- LaunchDarkly → Organization settings → Authorization → create an access token with the **Reader** role. Settings → LaunchDarkly: token, project key, environments to show (e.g. production, staging).`,
    '',
    '### 5. Claude drafting (optional)',
    '',
    `- Default provider **Claude Code login** uses the local \`claude\` CLI and its own login (${claude ? 'found' : 'not found: install Claude Code and run `claude` once to log in, then restart Dispatch'}). Or pick **Anthropic API** and paste an API key in Settings → AI. **Test** checks it.`,
    '',
    '### 6. Use Dispatch from Claude Code (MCP, optional)',
    '',
    '```sh',
    `claude mcp add dispatch --scope user -- ${process.execPath} ${tsx} ${mcpEntry}`,
    '```',
    '',
    'Then `/mcp` in Claude Code should list `dispatch` with tools like `overview`, `list_prs` and `create_jira_issue`.',
    '',
    '### 7. Check',
    '',
    `- \`curl -s ${origin}/api/health\` answers with the version; Sync in the header finishes without errors (hover it for the steps); the Overview shows my PRs${s.jira?.apiToken ? ', Jira issues' : ''}${s.slack?.token ? ' and Slack inbox' : ''}.`,
    '',
    'Start with the first item above that is not ✅.',
  ]
  return out.join('\n') + '\n'
}
