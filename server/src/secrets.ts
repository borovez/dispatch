import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Secrets (GitHub, Jira, Slack, LaunchDarkly tokens, the Anthropic key) live in the macOS Keychain,
 * not in the database: the database keeps a `keychain:` marker. Items are generic passwords under the
 * service "Dispatch", one per secret ("github:<account id>", "jira", …), visible in Keychain Access.
 *
 * Uses Apple's `security` tool, so every Dispatch process (background service, dev server, the Mac
 * app's bundled server, the MCP server) reads the same items. Secrets are written through its stdin
 * (`security -i`), never on a command line where `ps` could show them. Elsewhere (Linux) or with
 * DISPATCH_KEYCHAIN=0, secrets stay in the database as before.
 */
const SECURITY = '/usr/bin/security'
const SERVICE = 'Dispatch'
/** Items saved before the rename; moved to SERVICE the first time they're read */
const LEGACY_SERVICE = 'PR Deck'
export const KEYCHAIN_MARK = 'keychain:'
export const keychainEnabled =
  process.platform === 'darwin' && (process.env.DISPATCH_KEYCHAIN ?? process.env.PRDECK_KEYCHAIN) !== '0' && existsSync(SECURITY)

const CACHE_MS = 60_000
const cache = new Map<string, { value: string | null; at: number }>()

/** The secret, or null when there's no such item (or the keychain is locked) */
export function readSecret(name: string): string | null {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  let value = find(SERVICE, name)
  if (value === null) {
    const legacy = find(LEGACY_SERVICE, name)
    if (legacy !== null) {
      try {
        writeSecret(name, legacy, `Dispatch: ${name}`)
        execFileSync(SECURITY, ['delete-generic-password', '-s', LEGACY_SERVICE, '-a', name], { stdio: 'ignore', timeout: 10_000 })
      } catch {
        /* keep reading the old item */
      }
      value = legacy
    }
  }
  cache.set(name, { value, at: Date.now() })
  return value
}

function find(service: string, name: string): string | null {
  try {
    return execFileSync(SECURITY, ['find-generic-password', '-s', service, '-a', name, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).replace(/\n$/, '')
  } catch {
    return null
  }
}

/** Store (or replace) a secret, then read it back: throws if the keychain didn't keep it */
export function writeSecret(name: string, value: string, label: string) {
  const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  execFileSync(SECURITY, ['-i'], {
    input: `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(name)} -l ${quote(label)} -w ${quote(value)}\n`,
    stdio: ['pipe', 'ignore', 'pipe'],
    timeout: 10_000,
  })
  cache.delete(name)
  if (readSecret(name) !== value) {
    cache.delete(name)
    throw new Error(`Couldn't store the ${label} in the macOS Keychain`)
  }
}

export function deleteSecret(name: string) {
  cache.delete(name)
  try {
    execFileSync(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', name], { stdio: 'ignore', timeout: 10_000 })
  } catch {
    /* already gone */
  }
}
