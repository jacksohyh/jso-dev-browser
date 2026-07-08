import { useState } from 'react'

export function EditableLabel({
  value,
  onDone
}: {
  value: string
  onDone: (newValue: string | null) => void
}) {
  const [v, setV] = useState(value)
  return (
    <input
      className="edit"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
      onBlur={() => onDone(v.trim() || null)}
    />
  )
}
