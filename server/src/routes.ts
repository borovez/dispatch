/**
 * The API (`/api/*`). Routes live in ./routes/ by area; each module registers on the shared `api`
 * when imported, so the import order below is the registration order (keep it: Hono matches in order).
 * Tokens never leave the server.
 */
import './routes/core.ts'
import './routes/settings.ts'
import './routes/deps.ts'
import './routes/prs.ts'
import './routes/jira.ts'
import './routes/slack.ts'

export { api } from './routes/shared.ts'
