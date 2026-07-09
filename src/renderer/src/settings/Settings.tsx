import { useEffect, useState } from 'react'

interface Snapshot {
  origins: { origin: string; logins: { id: string; username: string }[] }[]
  available: boolean
}

function zoomPct(level: number): string {
  return `${Math.round(100 * 1.2 ** level)}%`
}

export function Settings() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [zoom, setZoom] = useState(0)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [alwaysCapture, setAlwaysCaptureState] = useState(false)

  useEffect(() => {
    window.devb.settingsList().then(setSnap)
    window.devb.settingsGetZoom().then(setZoom)
    window.devb.getAlwaysCapture().then(setAlwaysCaptureState)
    return window.devb.onSettingsZoom(setZoom)
  }, [])

  const setZoomLevel = (level: number) => {
    window.devb.settingsSetZoom(level)
    setZoom(level)
  }

  return (
    <div className="settings">
      <h2>Zoom</h2>
      <div className="zoom-row">
        <button onClick={() => setZoomLevel(Math.max(-3, zoom - 0.5))}>−</button>
        <span className="pct">{zoomPct(zoom)}</span>
        <button onClick={() => setZoomLevel(Math.min(3, zoom + 0.5))}>＋</button>
        <button onClick={() => setZoomLevel(0)}>Reset to 100%</button>
      </div>

      <h2>Network</h2>
      <label className="cap-toggle">
        <input
          type="checkbox"
          checked={alwaysCapture}
          onChange={async (e) => {
            const on = e.target.checked
            setAlwaysCaptureState(on)
            await window.devb.setAlwaysCapture(on)
          }}
        />
        Always capture network — record every tab's requests from load, so the Network panel shows the full history even if you open it late.
      </label>

      <h2>Saved passwords</h2>
      {snap && !snap.available && <p className="warn">OS encryption unavailable — saving is disabled.</p>}
      {snap?.origins.length === 0 && <p className="dim">No saved passwords yet.</p>}
      {snap?.origins.map((o) => (
        <div key={o.origin} className="origin">
          <div className="origin-name">{o.origin}</div>
          {o.logins.map((l) => (
            <div key={l.id} className="login">
              <span className="user">{l.username}</span>
              <span className="secret">{revealed[l.id] ?? '••••••••'}</span>
              <button
                onClick={async () => {
                  const pw = await window.devb.settingsReveal(l.id)
                  if (pw != null) setRevealed((r) => ({ ...r, [l.id]: pw }))
                }}
              >
                Reveal
              </button>
              <button
                onClick={async () => {
                  try {
                    const pw = await window.devb.settingsReveal(l.id)
                    if (pw != null) await navigator.clipboard.writeText(pw)
                  } catch {
                    /* clipboard blocked — ignore */
                  }
                }}
              >
                Copy
              </button>
              <button
                onClick={async () => {
                  setSnap(await window.devb.settingsDelete(l.id))
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ))}

      <h2>Shortcuts</h2>
      <table className="keys">
        <tbody>
          <tr><td>Ctrl+T / Ctrl+W</td><td>New / close tab</td></tr>
          <tr><td>Ctrl+Tab</td><td>Next tab (wraps)</td></tr>
          <tr><td>Ctrl+Shift+Tab</td><td>Next group (wraps)</td></tr>
          <tr><td>Ctrl+L</td><td>Focus address bar</td></tr>
          <tr><td>Ctrl+R</td><td>Reload</td></tr>
          <tr><td>Ctrl+= / Ctrl+- / Ctrl+0</td><td>Zoom in / out / reset</td></tr>
          <tr><td>Ctrl+wheel</td><td>Zoom</td></tr>
          <tr><td>F12 / Ctrl+Shift+F12</td><td>Network panel / DevTools</td></tr>
        </tbody>
      </table>
    </div>
  )
}
