import { useEffect, useRef, useState } from 'react'
import type { GroupInfo } from '../../../shared/types'
import { EditableLabel } from './EditableLabel'

function GroupChip({ group, active }: { group: GroupInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [width, setWidth] = useState<number | null>(group.width ?? null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.devb.onStartRename((kind, id) => {
        if (kind === 'group' && id === group.id) setEditing(true)
      }),
    [group.id]
  )

  useEffect(
    () =>
      window.devb.onStartAdjust((id) => {
        if (id === group.id) {
          setWidth(group.width ?? ref.current?.offsetWidth ?? 90)
          setAdjusting(true)
        }
      }),
    [group.id, group.width]
  )

  // keep local width in sync with the persisted value while not actively adjusting
  useEffect(() => {
    if (!adjusting) setWidth(group.width ?? null)
  }, [group.width, adjusting])

  // Esc cancels the adjust (revert to persisted width)
  useEffect(() => {
    if (!adjusting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAdjusting(false)
        setWidth(group.width ?? null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjusting, group.width])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = width ?? ref.current?.offsetWidth ?? 90
    const onMove = (me: MouseEvent) => setWidth(Math.max(48, Math.min(400, startW + (me.clientX - startX))))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={ref}
      className={'chip' + (active ? ' active' : '') + (adjusting ? ' adjusting' : '')}
      style={width != null ? { width: `${width}px`, maxWidth: 'none' } : undefined}
      onClick={() => {
        if (!adjusting) window.devb.activateGroup(group.id)
      }}
      onDoubleClick={() => {
        if (!adjusting) setEditing(true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        window.devb.showGroupMenu(group.id)
      }}
    >
      {editing ? (
        <EditableLabel
          value={group.name}
          onDone={(v) => {
            if (v) window.devb.renameGroup(group.id, v)
            setEditing(false)
          }}
        />
      ) : (
        <span className="label">{group.name}</span>
      )}
      {adjusting && (
        <>
          <span
            className="adjust-tick"
            title="Done"
            onClick={(e) => {
              e.stopPropagation()
              if (width != null) window.devb.setGroupWidth(group.id, width)
              setAdjusting(false)
            }}
          >
            ✓
          </span>
          <span className="adjust-handle" title="Drag to resize" onMouseDown={startDrag} />
        </>
      )}
    </div>
  )
}

export function GroupBar({ groups, activeId }: { groups: GroupInfo[]; activeId: string }) {
  return (
    <div className="row groups">
      {groups.map((g) => (
        <GroupChip key={g.id} group={g} active={g.id === activeId} />
      ))}
      <button className="add" title="New group" onClick={() => window.devb.addGroup()}>
        +
      </button>
      <span className="spacer" />
      <button className="cog" title="Settings" onClick={() => window.devb.openSettings()}>
        ⚙
      </button>
    </div>
  )
}
