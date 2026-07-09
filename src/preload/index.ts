import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppState, RequestSummary } from '../shared/types'

const api = {
  // --- chrome window: state ---
  getState: (): Promise<AppState> => ipcRenderer.invoke('app:getState'),
  onState: (cb: (state: AppState) => void) => {
    const h = (_e: IpcRendererEvent, s: AppState) => cb(s)
    ipcRenderer.on('state:changed', h)
    return (): void => {
      ipcRenderer.removeListener('state:changed', h)
    }
  },
  onFocusAddress: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('chrome:focusAddress', h)
    return (): void => {
      ipcRenderer.removeListener('chrome:focusAddress', h)
    }
  },
  onStartRename: (cb: (kind: 'group' | 'tab', id: string) => void) => {
    const h = (_e: IpcRendererEvent, kind: 'group' | 'tab', id: string) => cb(kind, id)
    ipcRenderer.on('chrome:startRename', h)
    return (): void => {
      ipcRenderer.removeListener('chrome:startRename', h)
    }
  },

  // --- groups ---
  addGroup: (): Promise<void> => ipcRenderer.invoke('group:add'),
  renameGroup: (id: string, name: string): Promise<void> => ipcRenderer.invoke('group:rename', id, name),
  deleteGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', id),
  activateGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:activate', id),
  showGroupMenu: (id: string): Promise<void> => ipcRenderer.invoke('menu:group', id),
  setGroupWidth: (id: string, width: number): Promise<void> => ipcRenderer.invoke('group:setWidth', id, width),
  onStartAdjust: (cb: (groupId: string) => void) => {
    const h = (_e: IpcRendererEvent, id: string) => cb(id)
    ipcRenderer.on('chrome:startAdjust', h)
    return (): void => {
      ipcRenderer.removeListener('chrome:startAdjust', h)
    }
  },

  // --- tabs ---
  addTab: (groupId: string): Promise<void> => ipcRenderer.invoke('tab:add', groupId),
  duplicateTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:duplicate', id),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:close', id),
  renameTab: (id: string, name: string): Promise<void> => ipcRenderer.invoke('tab:rename', id, name),
  activateTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:activate', id),
  navigate: (id: string, input: string): Promise<void> => ipcRenderer.invoke('tab:navigate', id, input),
  back: (id: string): Promise<void> => ipcRenderer.invoke('tab:back', id),
  forward: (id: string): Promise<void> => ipcRenderer.invoke('tab:forward', id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke('tab:reload', id),
  togglePanel: (id: string): Promise<void> => ipcRenderer.invoke('panel:toggle', id),
  showTabMenu: (id: string): Promise<void> => ipcRenderer.invoke('menu:tab', id),

  // --- API panel window ---
  panelInit: (tabId: string): Promise<{ requests: RequestSummary[]; capturing: boolean }> =>
    ipcRenderer.invoke('panel:init', tabId),
  onRequests: (cb: (requests: RequestSummary[]) => void) => {
    const h = (_e: IpcRendererEvent, r: RequestSummary[]) => cb(r)
    ipcRenderer.on('panel:requests', h)
    return (): void => {
      ipcRenderer.removeListener('panel:requests', h)
    }
  },
  getRequestDetail: (tabId: string, requestId: string): Promise<unknown> =>
    ipcRenderer.invoke('panel:detail', tabId, requestId),
  getResponseBody: (tabId: string, requestId: string): Promise<string | null> =>
    ipcRenderer.invoke('panel:body', tabId, requestId),
  clearRequests: (tabId: string): Promise<void> => ipcRenderer.invoke('panel:clear', tabId),

  // --- settings / autofill save prompt ---
  openSettings: (): Promise<void> => ipcRenderer.invoke('settings:open'),
  onSavePrompt: (cb: (data: { origin: string; username: string }) => void) => {
    const h = (_e: IpcRendererEvent, d: { origin: string; username: string }) => cb(d)
    ipcRenderer.on('chrome:savePrompt', h)
    return (): void => {
      ipcRenderer.removeListener('chrome:savePrompt', h)
    }
  },
  savePassword: (accept: boolean): Promise<void> => ipcRenderer.invoke('save:decide', accept),
  neverSave: (): Promise<void> => ipcRenderer.invoke('save:never'),

  // --- settings window ---
  settingsList: (): Promise<{
    origins: { origin: string; logins: { id: string; username: string }[] }[]
    available: boolean
  }> => ipcRenderer.invoke('settings:list'),
  settingsReveal: (id: string): Promise<string | null> => ipcRenderer.invoke('settings:reveal', id),
  settingsDelete: (
    id: string
  ): Promise<{
    origins: { origin: string; logins: { id: string; username: string }[] }[]
    available: boolean
  }> => ipcRenderer.invoke('settings:delete', id),
  settingsGetZoom: (): Promise<number> => ipcRenderer.invoke('settings:getZoom'),
  settingsSetZoom: (level: number): Promise<void> => ipcRenderer.invoke('settings:setZoom', level),
  onSettingsZoom: (cb: (level: number) => void) => {
    const h = (_e: IpcRendererEvent, z: number) => cb(z)
    ipcRenderer.on('settings:zoom', h)
    return (): void => {
      ipcRenderer.removeListener('settings:zoom', h)
    }
  }
}

export type DevBrowserApi = typeof api

contextBridge.exposeInMainWorld('devb', api)
