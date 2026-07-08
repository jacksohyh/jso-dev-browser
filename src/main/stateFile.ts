import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState } from '../shared/types'

/** Returns null on missing/corrupt/misshapen file — caller starts fresh, never crashes. */
export function loadState(file: string): AppState | null {
  try {
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (
      !Array.isArray(data.groups) ||
      typeof data.activeGroupId !== 'string' ||
      typeof data.activeTabByGroup !== 'object' ||
      data.activeTabByGroup === null ||
      !data.groups.every(
        (g: any) =>
          Array.isArray(g?.tabs) &&
          g.tabs.every((t: any) => typeof t?.id === 'string' && typeof t?.partition === 'string')
      )
    ) {
      return null
    }
    return data as AppState
  } catch {
    return null
  }
}

export function saveState(file: string, state: AppState) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

/** Debounced save; failures log and the next change retries. */
export function debouncedSaver(file: string, getState: () => AppState, delayMs = 300) {
  let timer: NodeJS.Timeout | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      try {
        saveState(file, getState())
      } catch (err) {
        console.error('state save failed', err)
      }
    }, delayMs)
  }
}
