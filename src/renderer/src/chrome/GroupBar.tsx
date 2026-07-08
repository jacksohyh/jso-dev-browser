import { useEffect, useState } from 'react'
import type { GroupInfo } from '../../../shared/types'
import { EditableLabel } from './EditableLabel'

function GroupChip({ group, active }: { group: GroupInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  useEffect(
    () =>
      window.devb.onStartRename((kind, id) => {
        if (kind === 'group' && id === group.id) setEditing(true)
      }),
    [group.id]
  )
  return (
    <div
      className={'chip' + (active ? ' active' : '')}
      onClick={() => window.devb.activateGroup(group.id)}
      onDoubleClick={() => setEditing(true)}
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
      <button className="cog" title="Settings" onClick={() => (window.devb as any).openSettings?.()}>
        ⚙
      </button>
    </div>
  )
}
