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

  // --- groups ---
  addGroup: (): Promise<void> => ipcRenderer.invoke('group:add'),
  renameGroup: (id: string, name: string): Promise<void> => ipcRenderer.invoke('group:rename', id, name),
  deleteGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', id),
  activateGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:activate', id),

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

  // --- API panel window ---
  panelInit: (tabId: string): Promise<{ requests: RequestSummary[]; capturing: boolean }> =>
    ipcRenderer.invoke('panel:init', tabId),
  onRequests: (cb: (requests: RequestSummary[]) => void) => {
    const h = (_e: IpcRendererEvent, r: RequestSummary[]) => cb(r)
    ipcRenderer.on('panel:requests', h)
    return () => ipcRenderer.removeListener('panel:requests', h)
  },
  getRequestDetail: (tabId: string, requestId: string): Promise<unknown> =>
    ipcRenderer.invoke('panel:detail', tabId, requestId),
  getResponseBody: (tabId: string, requestId: string): Promise<string | null> =>
    ipcRenderer.invoke('panel:body', tabId, requestId),
  clearRequests: (tabId: string): Promise<void> => ipcRenderer.invoke('panel:clear', tabId)
}

export type DevBrowserApi = typeof api

contextBridge.exposeInMainWorld('devb', api)
