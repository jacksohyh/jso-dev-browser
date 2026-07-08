import { useState } from 'react'
import type { GroupInfo } from '../../../shared/types'
import { ContextMenu } from './ContextMenu'
import { EditableLabel } from './EditableLabel'

function GroupChip({ group, active }: { group: GroupInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <div
        className={'chip' + (active ? ' active' : '')}
        onClick={() => window.devb.activateGroup(group.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
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
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', onClick: () => setEditing(true) },
            {
              label: 'Delete',
              onClick: () => {
                if (confirm(`Delete group "${group.name}" and all its tabs?`)) {
                  window.devb.deleteGroup(group.id)
                }
              }
            }
          ]}
        />
      )}
    </>
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
    </div>
  )
}
