import { useEffect, useState } from 'react'

export function SavePrompt() {
  const [prompt, setPrompt] = useState<{ origin: string; username: string } | null>(null)

  useEffect(() => window.devb.onSavePrompt(setPrompt), [])

  if (!prompt) return null
  return (
    <div className="save-prompt">
      <span>
        Save password for <b>{prompt.username || '(no username)'}</b> @ {prompt.origin}?
      </span>
      <button
        onClick={() => {
          window.devb.savePassword(true)
          setPrompt(null)
        }}
      >
        Save
      </button>
      <button
        onClick={() => {
          window.devb.neverSave()
          setPrompt(null)
        }}
      >
        Never
      </button>
      <button
        className="x"
        onClick={() => {
          window.devb.savePassword(false)
          setPrompt(null)
        }}
      >
        ✕
      </button>
    </div>
  )
}
