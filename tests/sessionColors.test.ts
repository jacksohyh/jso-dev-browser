import { describe, expect, it } from 'vitest'
import { assignSessionColors, SESSION_PALETTE } from '../src/renderer/src/chrome/sessionColors'
import type { GroupInfo } from '../src/shared/types'

const tab = (id: string, partition: string): any => ({ id, name: id, customName: false, url: '', partition })
const group = (id: string, tabs: any[]): GroupInfo => ({ id, name: id, tabs })

describe('assignSessionColors', () => {
  it('assigns no color to solo partitions', () => {
    const groups = [group('g', [tab('a', 'p1'), tab('b', 'p2')])]
    const colors = assignSessionColors(groups)
    expect(colors.get('p1')).toBeNull()
    expect(colors.get('p2')).toBeNull()
  })

  it('assigns a palette color to shared partitions, stable by first appearance', () => {
    const groups = [
      group('g', [tab('a', 'shared'), tab('b', 'shared'), tab('c', 'solo'), tab('d', 'other'), tab('e', 'other')])
    ]
    const colors = assignSessionColors(groups)
    expect(colors.get('shared')).toBe(SESSION_PALETTE[0])
    expect(colors.get('other')).toBe(SESSION_PALETTE[1])
    expect(colors.get('solo')).toBeNull()
  })

  it('counts shared partitions across all groups', () => {
    const groups = [group('g1', [tab('a', 'p')]), group('g2', [tab('b', 'p')])]
    const colors = assignSessionColors(groups)
    expect(colors.get('p')).toBe(SESSION_PALETTE[0])
  })

  it('wraps palette when more than 8 shared partitions exist', () => {
    const tabs: any[] = []
    for (let i = 0; i < 9; i++) {
      tabs.push(tab(`a${i}`, `p${i}`), tab(`b${i}`, `p${i}`))
    }
    const colors = assignSessionColors([group('g', tabs)])
    expect(colors.get('p8')).toBe(SESSION_PALETTE[8 % SESSION_PALETTE.length])
  })
})
