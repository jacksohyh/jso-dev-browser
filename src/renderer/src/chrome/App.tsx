import { useEffect, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { AddressBar } from './AddressBar'
import { GroupBar } from './GroupBar'
import { TabBar } from './TabBar'

export function App() {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    window.devb.getState().then(setState)
    return window.devb.onState(setState)
  }, [])

  if (!state) return null
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  const activeTabId = state.activeTabByGroup[group.id] ?? null
  const activeTab = group.tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <>
      <GroupBar groups={state.groups} activeId={group.id} />
      <TabBar group={group} activeTabId={activeTabId} groups={state.groups} />
      <AddressBar tab={activeTab} />
    </>
  )
}
