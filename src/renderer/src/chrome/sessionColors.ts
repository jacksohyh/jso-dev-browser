import type { GroupInfo } from '../../../shared/types'

/** 8-color palette for shared-session tab bars. */
export const SESSION_PALETTE = [
  '#61afef',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#c678dd',
  '#56b6c2',
  '#d19a66',
  '#ec6ea6'
]

/** Stable non-negative hash of a partition id (djb2-ish). */
function hashPartition(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Maps each partition to a palette color when 2+ tabs share it within the
 * same group, else null. Colors are assigned per group so that no two
 * shared sessions in the same group ever share a color: each partition
 * prefers a hash-derived color (stable, randomized-looking) but bumps
 * forward to the next free palette slot to avoid an in-group clash.
 * Uniqueness is per-group only — the same color may appear in different
 * groups, and a partition shared across groups may get a different color
 * in each (colors are drawn per in-group cluster).
 */
export function assignSessionColors(groups: GroupInfo[]): Map<string, string | null> {
  const result = new Map<string, string | null>()
  for (const g of groups) {
    const counts = new Map<string, number>()
    const order: string[] = []
    for (const t of g.tabs) {
      if (!counts.has(t.partition)) order.push(t.partition)
      counts.set(t.partition, (counts.get(t.partition) ?? 0) + 1)
    }
    const usedIdx = new Set<number>()
    for (const p of order) {
      if ((counts.get(p) ?? 0) < 2) {
        if (!result.has(p)) result.set(p, null)
        continue
      }
      const pref = hashPartition(p) % SESSION_PALETTE.length
      let idx = pref
      for (let k = 0; k < SESSION_PALETTE.length; k++) {
        const cand = (pref + k) % SESSION_PALETTE.length
        if (!usedIdx.has(cand)) {
          idx = cand
          break
        }
      }
      usedIdx.add(idx)
      result.set(p, SESSION_PALETTE[idx])
    }
  }
  return result
}
