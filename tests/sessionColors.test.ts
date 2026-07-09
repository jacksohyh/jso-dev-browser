import { describe, expect, it } from 'vitest'
import { assignSessionColors, SESSION_PALETTE } from '../src/renderer/src/chrome/sessionColors'
import type { GroupInfo } from '../src/shared/types'

describe('assignSessionColors', () => {
  const tab = (id: string, partition: string): any => ({ id, name: id, customName: false, url: '', partition })
  const group = (id: string, tabs: any[]): GroupInfo => ({ id, name: id, tabs })

  it('assigns no color to solo partitions', () => {
    const colors = assignSessionColors([group('g', [tab('a', 'p1'), tab('b', 'p2')])])
    expect(colors.get('p1')).toBeNull()
    expect(colors.get('p2')).toBeNull()
  })

  it('colors a partition shared by 2+ tabs in the same group', () => {
    const colors = assignSessionColors([group('g', [tab('a', 'shared'), tab('b', 'shared'), tab('c', 'solo')])])
    expect(SESSION_PALETTE).toContain(colors.get('shared'))
    expect(colors.get('solo')).toBeNull()
  })

  it('never repeats a color within one group', () => {
    // 5 distinct shared sessions in one group -> 5 distinct colors
    const tabs: any[] = []
    for (let i = 0; i < 5; i++) tabs.push(tab(`a${i}`, `p${i}`), tab(`b${i}`, `p${i}`))
    const colors = assignSessionColors([group('g', tabs)])
    const used = ['p0', 'p1', 'p2', 'p3', 'p4'].map((p) => colors.get(p))
    expect(new Set(used).size).toBe(5) // all distinct
    used.forEach((c) => expect(SESSION_PALETTE).toContain(c))
  })

  it('requires 2+ in the SAME group (cross-group single occurrences are solo)', () => {
    const colors = assignSessionColors([group('g1', [tab('a', 'p')]), group('g2', [tab('b', 'p')])])
    expect(colors.get('p')).toBeNull() // one tab in each group, not a cluster in either
  })

  it('a partition keeps its preferred hash color when free', () => {
    const colors = assignSessionColors([group('g', [tab('a', 'onlyshared'), tab('b', 'onlyshared')])])
    const preferred = SESSION_PALETTE[hashForTest('onlyshared') % SESSION_PALETTE.length]
    expect(colors.get('onlyshared')).toBe(preferred)
  })

  it('is deterministic', () => {
    const mk = () => assignSessionColors([group('g', [tab('a', 'x'), tab('b', 'x'), tab('c', 'y'), tab('d', 'y')])])
    expect([...mk().entries()]).toEqual([...mk().entries()])
  })
})

// mirror of the module's internal hash so the "preferred color" test can compute the expectation
function hashForTest(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
