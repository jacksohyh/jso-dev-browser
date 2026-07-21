import { useEffect, useRef, useState } from 'react'
import type { RequestSummary } from '../../../shared/types'

interface StoredRequestView extends RequestSummary {
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string>
}

function pretty(s: string | null): string {
  if (s == null || s === '') return '—'
  if (s.length > 200_000) return s.slice(0, 200_000) + `\n… (${s.length.toLocaleString()} chars total, truncated)`
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function Headers({ headers }: { headers: Record<string, string> }) {
  const keys = Object.keys(headers)
  if (keys.length === 0) return <p className="dim">—</p>
  return (
    <table className="kv">
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{headers[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type DetailTab = 'headers' | 'payload' | 'response'
const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'headers', label: 'Headers' },
  { id: 'payload', label: 'Payload' },
  { id: 'response', label: 'Response' }
]

function Detail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<StoredRequestView | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  // Kept across selections (like Chrome) — stay on Response while clicking through requests.
  const [tab, setTab] = useState<DetailTab>('headers')

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setBody(null)
    setMissing(false)
    window.devb.getRequestDetail(requestId).then((d) => {
      if (cancelled) return
      if (d == null) setMissing(true)
      else setDetail(d as StoredRequestView)
    })
    window.devb.getResponseBody(requestId).then((b) => {
      if (!cancelled) setBody(b)
    })
    return () => {
      cancelled = true
    }
  }, [requestId])

  if (missing) return <div className="detail dim">request no longer in the buffer</div>
  if (!detail) return <div className="detail dim">loading…</div>
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dtabs">
          {DETAIL_TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'dtab sel' : 'dtab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="detail-close" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="detail-body">
        {tab === 'headers' && (
          <>
            <h3>
              {detail.method} {detail.status ?? ''} {detail.failed ? `FAILED: ${detail.failed}` : ''}
              {detail.durationMs != null && <span className="dim"> · {detail.durationMs}ms</span>}
            </h3>
            <p className="url">{detail.url}</p>
            {detail.redirects && detail.redirects.length > 0 && (
              <div>
                {detail.redirects.map((r, i) => (
                  <p key={i} className="url">
                    ↪ redirected from {r.url} ({r.status ?? '?'})
                  </p>
                ))}
              </div>
            )}
            <h4>Request headers</h4>
            <Headers headers={detail.requestHeaders} />
            <h4>Response headers</h4>
            <Headers headers={detail.responseHeaders} />
          </>
        )}
        {tab === 'payload' && <pre>{pretty(detail.requestBody)}</pre>}
        {tab === 'response' && <pre>{pretty(body)}</pre>}
      </div>
    </div>
  )
}

export function Panel() {
  const [tabId, setTabId] = useState<string | null>(null)
  const [tabName, setTabName] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [requests, setRequests] = useState<RequestSummary[]>([])
  const [filter, setFilter] = useState('')
  const [apiOnly, setApiOnly] = useState(true)
  const [alwaysCap, setAlwaysCap] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const followRef = useRef(true)
  const [version, setVersion] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apply = (s: { tabId: string | null; tabName: string; capturing: boolean; requests: RequestSummary[] }) => {
      setTabId((prev) => {
        if (prev !== s.tabId) setSelected(null) // reset selection when the shown tab changes
        return s.tabId
      })
      setTabName(s.tabName)
      setCapturing(s.capturing)
      setRequests(s.requests)
      setVersion((v) => v + 1)
    }
    window.devb.panelInit().then(apply)
    window.devb.getAlwaysCapture().then(setAlwaysCap)
    return window.devb.onPanelState(apply)
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [version])

  const shown = requests.filter(
    (r) =>
      (!apiOnly || r.resourceType === 'Fetch' || r.resourceType === 'XHR') &&
      (!filter || r.url.includes(filter))
  )

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="tabname" title={tabName}>
          {tabName || 'no tab'}
        </span>
        <input placeholder="filter url, e.g. /api/" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label>
          <input type="checkbox" checked={apiOnly} onChange={(e) => setApiOnly(e.target.checked)} /> fetch/XHR only
        </label>
        <label title="Record every tab's requests from load (persists)">
          <input
            type="checkbox"
            checked={alwaysCap}
            onChange={async (e) => {
              const on = e.target.checked
              setAlwaysCap(on)
              await window.devb.setAlwaysCapture(on)
            }}
          />{' '}
          always capture
        </label>
        <button
          onClick={() => {
            window.devb.clearRequests()
            setSelected(null)
          }}
        >
          Clear
        </button>
        {!capturing && <span className="warn">not capturing (open DevTools closed? enable Always capture in Settings)</span>}
      </div>
      <div className="split">
        <div
          className="list"
          ref={listRef}
          onScroll={() => {
            const el = listRef.current
            if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          <table>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className={(selected === r.id ? 'sel ' : '') + (r.failed ? 'failed' : '')}
                  onClick={() => setSelected(r.id)}
                >
                  <td className="method">{r.method}</td>
                  <td className="path" title={r.url}>
                    {shortUrl(r.url)}
                  </td>
                  <td className="status">{r.failed ? 'ERR' : (r.status ?? '…')}</td>
                  <td className="dur">{r.durationMs != null ? `${r.durationMs}ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="dim empty">no requests yet — interact with the page</p>}
        </div>
        {selected && <Detail requestId={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}
