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

  it('returns null when nested tabs are misshapen', () => {
    writeFileSync(
      file,
      JSON.stringify({
        groups: [{ id: 'g', name: 'x', tabs: [{ id: 't' }] }],
        activeGroupId: 'g',
        activeTabByGroup: {}
      })
    )
    expect(loadState(file)).toBeNull()
  })

  it('defaults missing zoom to 0 for back-compat', () => {
    const s = createInitialState()
    const { zoom, ...noZoom } = s as any
    writeFileSync(file, JSON.stringify(noZoom))
    const loaded = loadState(file)
    expect(loaded).not.toBeNull()
    expect(loaded!.zoom).toBe(0)
  })

  it('preserves a valid zoom value', () => {
    const s = createInitialState()
    s.zoom = 2
    saveState(file, s)
    expect(loadState(file)!.zoom).toBe(2)
  })

  it('defaults missing alwaysCapture to false', () => {
    const s = createInitialState()
    const { alwaysCapture, ...rest } = s as any
    writeFileSync(file, JSON.stringify(rest))
    expect(loadState(file)!.alwaysCapture).toBe(false)
  })
})
