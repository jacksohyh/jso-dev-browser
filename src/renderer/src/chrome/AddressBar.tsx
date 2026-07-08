import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '../../../shared/types'

export function AddressBar({ tab }: { tab: TabInfo | null }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  // Reflect the tab's URL unless the user is typing.
  useEffect(() => {
    if (!focused) setValue(!tab || tab.url === 'about:blank' ? '' : tab.url)
  }, [tab?.id, tab?.url, focused])

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
      <button disabled={!tab} title="Reload (Ctrl+R)" onClick={() => tab && window.devb.reload(tab.id)}>
        ⟳
      </button>
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
      <button disabled={!tab} title="API panel (F12)" onClick={() => tab && window.devb.togglePanel(tab.id)}>
        API
      </button>
    </div>
  )
}
