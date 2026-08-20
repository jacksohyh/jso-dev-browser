import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '../../../shared/types'
import { DownloadsButton } from './DownloadsButton'

export function AddressBar({ tab }: { tab: TabInfo | null }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLInputElement>(null)

  // Reflect the tab's URL unless the user is typing.
  useEffect(() => {
    if (!focused) setValue(!tab || tab.url === 'about:blank' ? '' : tab.url)
  }, [tab?.id, tab?.url, focused])

  // Track which tabs are mid-load so the reload button can show progress.
  useEffect(
    () =>
      window.devb.onLoading(({ id, loading }) => {
        setLoadingIds((prev) => {
          const next = new Set(prev)
          if (loading) next.add(id)
          else next.delete(id)
          return next
        })
      }),
    []
  )
  const isLoading = !!tab && loadingIds.has(tab.id)

  // Mobile-view state follows the active tab.
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (tab) window.devb.getMobile(tab.id).then(setMobile)
    else setMobile(false)
  }, [tab?.id])

  useEffect(
    () =>
      window.devb.onFocusAddress(() => {
        ref.current?.focus()
        ref.current?.select()
      }),
    []
  )

  return (
    <div className="row addr">
      <button disabled={!tab} title="Back" onClick={() => tab && window.devb.back(tab.id)}>
        ◀
      </button>
      <button disabled={!tab} title="Forward" onClick={() => tab && window.devb.forward(tab.id)}>
        ▶
      </button>
      <button
        disabled={!tab}
        className={isLoading ? 'stop' : undefined}
        title={isLoading ? 'Stop' : 'Reload (Ctrl+R)'}
        onClick={() => {
          if (!tab) return
          if (isLoading) window.devb.stopLoad(tab.id)
          else window.devb.reload(tab.id)
        }}
      >
        {isLoading ? '✕' : '⟳'}
      </button>
      <div className="addr-input">
        {isLoading && <span className="spinner" aria-hidden />}
        <input
          ref={ref}
          disabled={!tab}
          placeholder={tab ? 'URL, host, or :port — Enter to go (Ctrl+L)' : 'open a tab with +'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tab && value.trim()) {
              window.devb.navigate(tab.id, value)
              ref.current?.blur()
            }
          }}
        />
      </div>
      <button
        disabled={!tab}
        className={mobile ? 'mobile-on' : undefined}
        title={mobile ? 'Exit mobile view' : 'Mobile view (375×812 + phone UA, reloads page)'}
        onClick={async () => {
          if (!tab) return
          const on = await window.devb.toggleMobile(tab.id)
          if (on != null) setMobile(on)
        }}
      >
        📱
      </button>
      <button disabled={!tab} title="Network panel (F12)" onClick={() => tab && window.devb.togglePanel()}>
        Network
      </button>
      <DownloadsButton />
    </div>
  )
}
