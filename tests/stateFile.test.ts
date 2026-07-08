import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInitialState } from '../src/main/state'
import { loadState, saveState } from '../src/main/stateFile'

describe('stateFile', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'devb-'))
    file = join(dir, 'state.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips state', () => {
    const state = createInitialState()
    state.groups[0].name = 'Project A'
    saveState(file, state)
    expect(loadState(file)).toEqual(state)
  })

  it('returns null for a missing file', () => {
    expect(loadState(file)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    writeFileSync(file, '{not json')
    expect(loadState(file)).toBeNull()
  })

  it('returns null for JSON with the wrong shape', () => {
    writeFileSync(file, JSON.stringify({ groups: 5 }))
    expect(loadState(file)).toBeNull()
  })
})
