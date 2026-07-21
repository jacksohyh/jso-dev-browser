import { session } from 'electron'
import type { Cookie, Session } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type SavedCookie = {
  url: string
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/**
 * Persists per-partition SESSION cookies to disk and restores them on startup.
 *
 * Why: Electron keeps *persistent* cookies (those with an expiry) in the
 * `persist:` partition's on-disk cookie DB, but SESSION cookies (no expiry)
 * live only in memory and are dropped when the app quits. Many SPAs — including
 * design-den-v2, whose `accessToken` is a session cookie — therefore log you
 * out on restart. Chrome hides this with its "continue where you left off"
 * session-restore; we do the same here so a reopened tab stays logged in.
 *
 * We deliberately persist ONLY session cookies: persistent cookies already
 * survive via Electron's own store, so re-injecting them would be redundant and
 * could clobber fresher values.
 */
export class CookieStore {
  private ready = new Set<string>() // partitions already restored + watched
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  private file(partition: string): string {
    // partition e.g. "persist:tab-<uuid>"; ':' and '/' are illegal on Windows.
    return join(this.dir, partition.replace(/[:\\/]/g, '_') + '.json')
  }

  /**
   * Restore saved session cookies into the partition (once per app run), then
   * watch it for changes. Resolves *after* the restore so the caller can defer
   * the tab's first navigation until its cookies are in place.
   */
  async prepare(partition: string): Promise<void> {
    if (this.ready.has(partition)) return
    this.ready.add(partition)
    const ses = session.fromPartition(partition)
    await this.restore(ses, partition)
    // Save whenever cookies change (e.g. a login sets the token), debounced.
    // Attached AFTER restore so our own restore writes don't trigger a save.
    ses.cookies.on('changed', () => this.scheduleSave(ses, partition))
  }

  private async restore(ses: Session, partition: string): Promise<void> {
    const path = this.file(partition)
    if (!existsSync(path)) return
    let saved: SavedCookie[]
    try {
      saved = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return // corrupt file — ignore
    }
    await Promise.all(
      saved.map((c) =>
        ses.cookies.set(c).catch(() => {
          /* stale/invalid cookie — skip it */
        })
      )
    )
  }

  private scheduleSave(ses: Session, partition: string): void {
    const existing = this.timers.get(partition)
    if (existing) clearTimeout(existing)
    this.timers.set(
      partition,
      setTimeout(() => {
        this.timers.delete(partition)
        void this.save(ses, partition)
      }, 800)
    )
  }

  private async save(ses: Session, partition: string): Promise<void> {
    let cookies: Cookie[]
    try {
      cookies = await ses.cookies.get({})
    } catch {
      return
    }
    const saved: SavedCookie[] = cookies
      .filter((c) => c.session) // only session cookies — persistent ones survive natively
      .map((c) => {
        const bare = (c.domain ?? '').replace(/^\./, '')
        const out: SavedCookie = {
          url: `${c.secure ? 'https' : 'http'}://${bare}${c.path || '/'}`,
          name: c.name,
          value: c.value,
          path: c.path
        }
        // Preserve domain-cookie scope; omit domain for host-only cookies so
        // Electron derives host-only from the url (passing it would widen scope).
        if (!c.hostOnly && c.domain) out.domain = c.domain
        if (c.secure) out.secure = true
        if (c.httpOnly) out.httpOnly = true
        if (c.sameSite) out.sameSite = c.sameSite
        return out
      })
    try {
      const path = this.file(partition)
      if (saved.length) writeFileSync(path, JSON.stringify(saved))
      else if (existsSync(path)) rmSync(path)
    } catch {
      /* best effort */
    }
  }

  /** Delete a partition's saved cookies (call when the partition is wiped). */
  forget(partition: string): void {
    const t = this.timers.get(partition)
    if (t) {
      clearTimeout(t)
      this.timers.delete(partition)
    }
    this.ready.delete(partition)
    try {
      const p = this.file(partition)
      if (existsSync(p)) rmSync(p)
    } catch {
      /* ignore */
    }
  }

  /** Startup cleanup: drop cookie files for partitions no tab references anymore. */
  prune(validPartitions: Set<string>): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return
    }
    const valid = new Set([...validPartitions].map((p) => p.replace(/[:\\/]/g, '_') + '.json'))
    for (const name of names) {
      if (name.endsWith('.json') && !valid.has(name)) {
        try {
          rmSync(join(this.dir, name))
        } catch {
          /* ignore */
        }
      }
    }
  }
}
