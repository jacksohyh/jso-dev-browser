import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PasswordEntry, SavedLogin } from '../shared/types'

/** Minimal shape of Electron's safeStorage, injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

interface VaultFile {
  entries: PasswordEntry[]
  neverOrigins: string[]
}

/** Encrypted password store. Secrets are safeStorage ciphertext (base64); origin/username plaintext. */
export class Vault {
  readonly available: boolean
  private data: VaultFile = { entries: [], neverOrigins: [] }

  constructor(
    private file: string,
    private safe: SafeStorageLike
  ) {
    this.available = safe.isEncryptionAvailable()
    this.load()
  }

  private load() {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed.entries) && Array.isArray(parsed.neverOrigins)) {
        this.data = parsed
      }
    } catch {
      this.data = { entries: [], neverOrigins: [] }
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  /** Returns the entry, or null if encryption is unavailable. Updates in place on (origin,username) match. */
  add(origin: string, username: string, password: string): PasswordEntry | null {
    if (!this.available) return null
    const secret = this.safe.encryptString(password).toString('base64')
    const existing = this.data.entries.find((e) => e.origin === origin && e.username === username)
    if (existing) {
      existing.secret = secret
      this.save()
      return existing
    }
    const entry: PasswordEntry = { id: randomUUID(), origin, username, secret }
    this.data.entries.push(entry)
    this.save()
    return entry
  }

  list(origin: string): SavedLogin[] {
    return this.data.entries
      .filter((e) => e.origin === origin)
      .map((e) => ({ id: e.id, username: e.username }))
  }

  get(id: string): string | null {
    const entry = this.data.entries.find((e) => e.id === id)
    if (!entry) return null
    try {
      return this.safe.decryptString(Buffer.from(entry.secret, 'base64'))
    } catch {
      return null
    }
  }

  remove(id: string) {
    this.data.entries = this.data.entries.filter((e) => e.id !== id)
    this.save()
  }

  allOrigins(): string[] {
    return [...new Set(this.data.entries.map((e) => e.origin))]
  }

  never(origin: string) {
    if (!this.data.neverOrigins.includes(origin)) {
      this.data.neverOrigins.push(origin)
      this.save()
    }
  }

  isNever(origin: string): boolean {
    return this.data.neverOrigins.includes(origin)
  }
}
