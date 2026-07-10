import { useEffect, useRef, useState } from 'react'

export function FindBar() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ active: number; total: number } | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const offOpen = window.devb.onFindOpen(() => {
      setOpen(true)
      setResult(null)
      setTimeout(() => {
        ref.current?.focus()
        ref.current?.select()
      }, 0)
    })
    const offRes = window.devb.onFindResult(setResult)
    return () => {
      offOpen()
      offRes()
    }
  }, [])

  const close = () => {
    window.devb.findStop()
    setOpen(false)
    setText('')
    setResult(null)
  }

  if (!open) return null
  return (
    <div className="find-bar">
      <input
        ref={ref}
        placeholder="Find in page"
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          if (v) window.devb.findQuery(v, true, false)
          else setResult(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (text) window.devb.findQuery(text, !e.shiftKey, true)
          } else if (e.key === 'Escape') {
            close()
          }
        }}
      />
      <span className="find-count">
        {result && result.total > 0 ? `${result.active}/${result.total}` : text ? '0/0' : ''}
      </span>
      <button title="Previous (Shift+Enter)" onClick={() => text && window.devb.findQuery(text, false, true)}>↑</button>
      <button title="Next (Enter)" onClick={() => text && window.devb.findQuery(text, true, true)}>↓</button>
      <button className="find-close" title="Close (Esc)" onClick={close}>✕</button>
    </div>
  )
}
