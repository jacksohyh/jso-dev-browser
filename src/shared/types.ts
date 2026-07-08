export interface TabInfo {
  id: string
  name: string
  customName: boolean // true once the user renames; page titles stop overriding
  url: string
  partition: string // 'persist:tab-<uuid>' — Electron session partition
}

export interface GroupInfo {
  id: string
  name: string
  tabs: TabInfo[]
}

export interface AppState {
  groups: GroupInfo[]
  activeGroupId: string
  activeTabByGroup: Record<string, string>
}

export interface RequestSummary {
  id: string
  method: string
  url: string
  resourceType: string // CDP type: 'Fetch' | 'XHR' | 'Document' | ...
  status: number | null // null until a response arrives
  durationMs: number | null // null until loading finishes
  failed?: string // CDP errorText when the request failed
}
