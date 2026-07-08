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

  it('assigns a palette color to partitions shared by 2+ tabs', () => {
    const colors = assignSessionColors([group('g', [tab('a', 'shared'), tab('b', 'shared'), tab('c', 'solo')])])
    expect(SESSION_PALETTE).toContain(colors.get('shared'))
    expect(colors.get('solo')).toBeNull()
  })

  it('counts shared partitions across all groups', () => {
    const colors = assignSessionColors([group('g1', [tab('a', 'p')]), group('g2', [tab('b', 'p')])])
    expect(SESSION_PALETTE).toContain(colors.get('p'))
  })

  it('a partition color depends only on its own id — untouched sessions keep their color under churn', () => {
    const before = assignSessionColors([
      group('g', [tab('a', 'shared'), tab('b', 'shared'), tab('c', 'other'), tab('d', 'other')])
    ])
    // 'shared' drops to a single tab (solo); 'other' is untouched
    const after = assignSessionColors([group('g', [tab('a', 'shared'), tab('c', 'other'), tab('d', 'other')])])
    expect(after.get('other')).toBe(before.get('other'))
    expect(after.get('shared')).toBeNull()
  })

  it('is deterministic: same partition id maps to the same color regardless of context', () => {
    const c1 = assignSessionColors([group('g', [tab('a', 'p'), tab('b', 'p')])])
    const c2 = assignSessionColors([group('g2', [tab('x', 'p'), tab('y', 'p')])])
    expect(c1.get('p')).toBe(c2.get('p'))
  })
})
