import { useEffect, useRef, useState } from 'react'
import type { DownloadRecord } from '../../../shared/types'

const isActive = (r: DownloadRecord): boolean => r.state === 'progressing' || r.state === 'paused'
const isFail = (r: DownloadRecord): boolean => r.state === 'interrupted' || r.state === 'cancelled'

/** Toolbar downloads button: live % while downloading, then a pass/fail dot until opened. */
export function DownloadsButton() {
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [flash, setFlash] = useState<'ok' | 'fail' | null>(null)
  const prevActive = useRef<Set<string>>(new Set())

  useEffect(() => {
    window.devb.downloadsInit().then(setRecords)
    return window.devb.onDownloads(setRecords)
  }, [])

  // When a download leaves the active set, flash a green/red dot on the button.
  useEffect(() => {
    const nowActive = new Set(records.filter(isActive).map((r) => r.id))
    for (const id of prevActive.current) {
      if (!nowActive.has(id)) {
        const rec = records.find((r) => r.id === id)
        if (rec) setFlash(isFail(rec) ? 'fail' : 'ok')
      }
    }
    prevActive.current = nowActive
  }, [records])

  const active = records.filter(isActive)
  const totalRecv = active.reduce((s, r) => s + r.receivedBytes, 0)
  const totalSize = active.reduce((s, r) => s + (r.totalBytes > 0 ? r.totalBytes : r.receivedBytes), 0)
  const pct = active.length && totalSize > 0 ? Math.round((totalRecv / totalSize) * 100) : null

  const cls = ['dl-btn']
  if (active.length) cls.push('active')
  else if (flash) cls.push(flash)

  const title = active.length
    ? `Downloading ${active.length} file${active.length > 1 ? 's' : ''}${pct != null ? ` — ${pct}%` : ''}`
    : 'Downloads'

  return (
    <button
      className={cls.join(' ')}
      title={title}
      onClick={() => {
        setFlash(null)
        window.devb.toggleDownloads()
      }}
    >
      <span className="dl-glyph">⬇</span>
      {active.length > 0 && <span className="dl-badge">{pct != null ? `${pct}%` : active.length}</span>}
      {!active.length && flash && <span className={`dl-status ${flash}`} />}
    </button>
  )
}
