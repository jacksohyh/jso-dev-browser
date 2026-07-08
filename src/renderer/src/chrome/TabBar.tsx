import { useState } from 'react'
import type { GroupInfo, TabInfo } from '../../../shared/types'
import { ContextMenu } from './ContextMenu'
import { EditableLabel } from './EditableLabel'

function TabChip({ tab, active }: { tab: TabInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <div
        className={'chip' + (active ? ' active' : '')}
        onClick={() => window.devb.activateTab(tab.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Duplicate (same session)', onClick: () => window.devb.duplicateTab(tab.id) },
            { label: 'Rename', onClick: () => setEditing(true) },
            { label: 'Close', onClick: () => window.devb.closeTab(tab.id) }
          ]}
        />
      )}
    </>
  )
}

export function TabBar({ group, activeTabId }: { group: GroupInfo; activeTabId: string | null }) {
  return (
    <div className="row tabs">
      {group.tabs.map((t) => (
        <TabChip key={t.id} tab={t} active={t.id === activeTabId} />
      ))}
      <button className="add" title="New tab (fresh session)" onClick={() => window.devb.addTab(group.id)}>
        +
      </button>
    </div>
  )
}
