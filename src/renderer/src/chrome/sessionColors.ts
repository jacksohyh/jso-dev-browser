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

/**
 * Maps each partition to a palette color when 2+ tabs share it, else null.
 * Colors are assigned by the partition's first appearance across all groups,
 * so they stay stable as tabs come and go.
 */
export function assignSessionColors(groups: GroupInfo[]): Map<string, string | null> {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const g of groups) {
    for (const t of g.tabs) {
      if (!counts.has(t.partition)) order.push(t.partition)
      counts.set(t.partition, (counts.get(t.partition) ?? 0) + 1)
    }
  }
  const result = new Map<string, string | null>()
  let sharedIdx = 0
  for (const partition of order) {
    if ((counts.get(partition) ?? 0) >= 2) {
      result.set(partition, SESSION_PALETTE[sharedIdx % SESSION_PALETTE.length])
      sharedIdx++
    } else {
      result.set(partition, null)
    }
  }
  return result
}
