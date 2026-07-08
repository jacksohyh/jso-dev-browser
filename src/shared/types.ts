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
  zoom: number // webContents zoom level shared by all tabs; 0 = 100%
}

export interface RequestSummary {
  id: string
  method: string
  url: string
  resourceType: string // CDP type: 'Fetch' | 'XHR' | 'Document' | ...
  status: number | null // null until a response arrives
  durationMs: number | null // null until loading finishes
  failed?: string // CDP errorText when the request failed
  redirects?: { url: string; status: number | null }[] // earlier legs of a redirect chain
}

export interface PasswordEntry {
  id: string
  origin: string
  username: string
  secret: string // base64 safeStorage ciphertext
}

export interface SavedLogin {
  id: string
  username: string // no secret — secret is fetched on explicit selection
}
