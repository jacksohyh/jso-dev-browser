import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  useEffect(() => {
    window.addEventListener('click', onClose)
    window.addEventListener('contextmenu', onClose)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('contextmenu', onClose)
    }
  }, [onClose])
  return (
    <div className="ctx" style={{ left: x, top: y }}>
      {items.map((it) => (
        <div
          key={it.label}
          className="ctx-item"
          onClick={(e) => {
            e.stopPropagation()
            it.onClick()
            onClose()
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}
