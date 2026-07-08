import { useEffect, useState } from 'react'
import type { GroupInfo, TabInfo } from '../../../shared/types'
import { EditableLabel } from './EditableLabel'
import { assignSessionColors } from './sessionColors'

function TabChip({ tab, active, color }: { tab: TabInfo; active: boolean; color: string | null }) {
  const [editing, setEditing] = useState(false)
  useEffect(
    () =>
      window.devb.onStartRename((kind, id) => {
        if (kind === 'tab' && id === tab.id) setEditing(true)
      }),
    [tab.id]
  )
  return (
    <div
      className={'chip' + (active ? ' active' : '')}
      style={color ? { borderTop: `2px solid ${color}` } : undefined}
      onClick={() => window.devb.activateTab(tab.id)}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) => {
        e.preventDefault()
        window.devb.showTabMenu(tab.id)
      }}
    >
      {editing ? (
        <EditableLabel
          value={tab.name}
          onDone={(v) => {
            if (v) window.devb.renameTab(tab.id, v)
            setEditing(false)
          }}
        />
      ) : (
        <span className="label">{tab.name}</span>
      )}
      <span
        className="close"
        title="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          window.devb.closeTab(tab.id)
        }}
      >
        ×
      </span>
    </div>
  )
}

export function TabBar({
  group,
  activeTabId,
  groups
}: {
  group: GroupInfo
  activeTabId: string | null
  groups: GroupInfo[]
}) {
  const colors = assignSessionColors(groups)
  return (
    <div className="row tabs">
      {group.tabs.map((t) => (
        <TabChip key={t.id} tab={t} active={t.id === activeTabId} color={colors.get(t.partition) ?? null} />
      ))}
      <button className="add" title="New tab (fresh session)" onClick={() => window.devb.addTab(group.id)}>
        +
      </button>
    </div>
  )
}
