import { useEffect, useState } from 'react'
import type { DownloadRecord } from '../../../shared/types'

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)} ${units[i]}`
}

const STATE_LABEL: Record<DownloadRecord['state'], string> = {
  progressing: 'Downloading',
  paused: 'Paused',
  completed: 'Done',
  cancelled: 'Cancelled',
  interrupted: 'Failed'
}

const isActive = (r: DownloadRecord): boolean => r.state === 'progressing' || r.state === 'paused'

export function Downloads() {
  const [records, setRecords] = useState<DownloadRecord[]>([])

  useEffect(() => {
    window.devb.downloadsInit().then(setRecords)
    return window.devb.onDownloads(setRecords)
  }, [])

  return (
    <div className="dl-root">
      <header className="dl-head">
        <span>Downloads</span>
        <button className="dl-clear" onClick={() => window.devb.downloadsClear()} disabled={records.length === 0}>
          Clear
        </button>
      </header>
      {records.length === 0 ? (
        <div className="dl-empty">No downloads yet</div>
      ) : (
        <ul className="dl-list">
          {records.map((r) => {
            const active = isActive(r)
            const pct = r.totalBytes > 0 ? Math.min(100, Math.round((r.receivedBytes / r.totalBytes) * 100)) : null
            return (
              <li key={r.id} className={`dl-item ${r.state}`}>
                <div className="dl-name" title={r.savePath}>
                  {r.filename}
                </div>
                <div className="dl-meta">
                  <span className={`dl-state ${r.state}`}>{STATE_LABEL[r.state]}</span>
                  <span className="dl-size">
                    {active
                      ? `${fmtBytes(r.receivedBytes)}${r.totalBytes > 0 ? ' / ' + fmtBytes(r.totalBytes) : ''}`
                      : fmtBytes(r.receivedBytes)}
                    {active && pct != null ? ` · ${pct}%` : ''}
                  </span>
                </div>
                {active && (
                  <div className="dl-bar">
                    <div className={`dl-fill ${pct == null ? 'indeterminate' : ''}`} style={pct != null ? { width: `${pct}%` } : undefined} />
                  </div>
                )}
                <div className="dl-actions">
                  {active ? (
                    <button onClick={() => window.devb.downloadCancel(r.id)}>Cancel</button>
                  ) : (
                    <>
                      {r.state === 'completed' && <button onClick={() => window.devb.downloadOpen(r.id)}>Open</button>}
                      <button onClick={() => window.devb.downloadShow(r.id)}>Show in folder</button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
