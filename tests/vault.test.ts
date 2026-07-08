import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../src/main/vault'

const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, '')
}

describe('Vault', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-'))
    file = join(dir, 'passwords.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('adds and lists logins by origin, without secrets', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://localhost:3000', 'admin', 'pw1')
    v.add('http://localhost:3000', 'user', 'pw2')
    v.add('http://other', 'x', 'pw3')
    const list = v.list('http://localhost:3000')
    expect(list.map((l) => l.username).sort()).toEqual(['admin', 'user'])
    expect((list[0] as any).secret).toBeUndefined()
    expect(v.list('http://none')).toEqual([])
  })

  it('get() returns the decrypted password by id', () => {
    const v = new Vault(file, fakeSafe)
    const entry = v.add('http://x', 'u', 'sekret')
    expect(v.get(entry!.id)).toBe('sekret')
    expect(v.get('missing')).toBeNull()
  })

  it('stores the secret encrypted, not as plaintext, on disk', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://x', 'u', 'sekret')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('sekret')
    expect(raw).toContain('u')
  })

  it('dedupes identical (origin, username, password)', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://x', 'u', 'pw')
    v.add('http://x', 'u', 'pw')
    expect(v.list('http://x')).toHaveLength(1)
  })

  it('updates the secret when the same (origin, username) has a new password', () => {
    const v = new Vault(file, fakeSafe)
    const a = v.add('http://x', 'u', 'old')
    const b = v.add('http://x', 'u', 'new')
    expect(a!.id).toBe(b!.id)
    expect(v.get(b!.id)).toBe('new')
    expect(v.list('http://x')).toHaveLength(1)
  })

  it('remove() deletes an entry', () => {
    const v = new Vault(file, fakeSafe)
    const e = v.add('http://x', 'u', 'pw')
    v.remove(e!.id)
    expect(v.list('http://x')).toHaveLength(0)
  })

  it('never()/isNever() track an ignore list', () => {
    const v = new Vault(file, fakeSafe)
    expect(v.isNever('http://x')).toBe(false)
    v.never('http://x')
    expect(v.isNever('http://x')).toBe(true)
  })

  it('persists across instances (reload from disk)', () => {
    const v1 = new Vault(file, fakeSafe)
    v1.add('http://x', 'u', 'pw')
    v1.never('http://y')
    const v2 = new Vault(file, fakeSafe)
    expect(v2.get(v2.list('http://x')[0].id)).toBe('pw')
    expect(v2.isNever('http://y')).toBe(true)
  })

  it('is disabled and never persists plaintext when encryption is unavailable', () => {
    const off = { ...fakeSafe, isEncryptionAvailable: () => false }
    const v = new Vault(file, off)
    expect(v.available).toBe(false)
    const e = v.add('http://x', 'u', 'pw')
    expect(e).toBeNull()
    expect(v.list('http://x')).toHaveLength(0)
  })

  it('starts empty on a corrupt file', () => {
    const { writeFileSync } = require('node:fs')
    writeFileSync(file, '{bad json')
    const v = new Vault(file, fakeSafe)
    expect(v.list('http://x')).toEqual([])
  })
})
