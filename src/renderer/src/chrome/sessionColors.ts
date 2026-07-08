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
 * Maps each partition to a palette color when 2+ tabs share it, else null.
 * The color is derived from a hash of the partition id, so a session's color
 * depends only on itself — closing a duplicate never recolors other sessions.
 */
export function assignSessionColors(groups: GroupInfo[]): Map<string, string | null> {
  const counts = new Map<string, number>()
  for (const g of groups) {
    for (const t of g.tabs) counts.set(t.partition, (counts.get(t.partition) ?? 0) + 1)
  }
  const result = new Map<string, string | null>()
  for (const [partition, count] of counts) {
    result.set(partition, count >= 2 ? SESSION_PALETTE[hashPartition(partition) % SESSION_PALETTE.length] : null)
  }
  return result
}
