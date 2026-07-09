import { useEffect, useState } from 'react'
import type { GroupInfo, TabInfo } from '../../../shared/types'
import { EditableLabel } from './EditableLabel'
import { assignSessionColors } from './sessionColors'

function TabChip({ tab, active }: { tab: TabInfo; active: boolean }) {
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

  type Run = { key: string; color: string | null; tabs: TabInfo[] }
  const runs: Run[] = []
  for (const t of group.tabs) {
    const color = colors.get(t.partition) ?? null
    const last = runs[runs.length - 1]
    if (last && last.color !== null && color !== null && last.tabs[0].partition === t.partition) {
      last.tabs.push(t)
    } else {
      runs.push({ key: t.id, color, tabs: [t] })
    }
  }

  return (
    <div className="row tabs">
      {runs.map((run) =>
        run.color && run.tabs.length >= 2 ? (
          <span
            key={run.key}
            className="session-wrap"
            style={{ border: `2px solid ${run.color}`, background: `${run.color}17` }}
          >
            {run.tabs.map((t) => (
              <TabChip key={t.id} tab={t} active={t.id === activeTabId} />
            ))}
          </span>
        ) : (
          run.tabs.map((t) => <TabChip key={t.id} tab={t} active={t.id === activeTabId} />)
        )
      )}
      <button className="add" title="New tab (fresh session)" onClick={() => window.devb.addTab(group.id)}>
        +
      </button>
    </div>
  )
}
