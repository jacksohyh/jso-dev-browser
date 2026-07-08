import { useEffect, useRef, useState } from 'react'
import type { RequestSummary } from '../../../shared/types'

interface StoredRequestView extends RequestSummary {
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string>
}

function pretty(s: string | null): string {
  if (s == null || s === '') return '—'
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

function Detail({ tabId, requestId }: { tabId: string; requestId: string }) {
  const [detail, setDetail] = useState<StoredRequestView | null>(null)
  const [body, setBody] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setBody(null)
    window.devb.getRequestDetail(tabId, requestId).then((d) => setDetail(d as StoredRequestView | null))
    window.devb.getResponseBody(tabId, requestId).then(setBody)
  }, [tabId, requestId])

  if (!detail) return <div className="detail dim">loading…</div>
  return (
    <div className="detail">
      <h3>
        {detail.method} {detail.status ?? ''} {detail.failed ? `FAILED: ${detail.failed}` : ''}
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
      <h4>Request body</h4>
      <pre>{pretty(detail.requestBody)}</pre>
      <h4>Response headers</h4>
      <Headers headers={detail.responseHeaders} />
      <h4>Response body</h4>
      <pre>{pretty(body)}</pre>
    </div>
  )
}

export function Panel({ tabId, initialCapturing }: { tabId: string; initialCapturing: boolean }) {
  const [requests, setRequests] = useState<RequestSummary[]>([])
  const [capturing, setCapturing] = useState(initialCapturing)
  const [filter, setFilter] = useState('')
  const [apiOnly, setApiOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.devb.panelInit(tabId).then((r) => {
      setRequests(r.requests)
      setCapturing(r.capturing)
    })
    return window.devb.onRequests(setRequests)
  }, [tabId])

  // Keep the list pinned to the newest entries.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [requests.length])

  const shown = requests.filter(
    (r) =>
      (!apiOnly || r.resourceType === 'Fetch' || r.resourceType === 'XHR') &&
      (!filter || r.url.includes(filter))
  )

  return (
    <div className="panel">
      <div className="toolbar">
        <input placeholder="filter url, e.g. /api/" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label>
          <input type="checkbox" checked={apiOnly} onChange={(e) => setApiOnly(e.target.checked)} /> fetch/XHR
          only
        </label>
        <button
          onClick={() => {
            window.devb.clearRequests(tabId)
            setSelected(null)
          }}
        >
          Clear
        </button>
        {!capturing && <span className="warn">capture unavailable (close DevTools and reopen panel)</span>}
      </div>
      <div className="split">
        <div className="list" ref={listRef}>
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
        {selected && <Detail tabId={tabId} requestId={selected} />}
      </div>
    </div>
  )
}
