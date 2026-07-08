import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { WebContents } from 'electron'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeUrl } from '../shared/normalizeUrl'
import { PanelManager } from './apiPanel'
import { AppStore } from './state'
import { debouncedSaver, loadState, saveState } from './stateFile'
import { TabManager } from './tabs'

let win: BrowserWindow
let store: AppStore
let tabs: TabManager
let panels: PanelManager

const stateFile = () => join(app.getPath('userData'), 'state.json')

/** Renderer clicks can race store reality (e.g. double-close) — swallow stale-id errors. */
function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', store.state)
}

function syncShownTab() {
  const tab = store.activeTab()
  if (tab) tabs.showTab(tab.id)
  else tabs.hideCurrent()
}

/** Startup safety net: delete partition dirs no tab references anymore. */
function cleanOrphanPartitions() {
  const dir = join(app.getPath('userData'), 'Partitions')
  if (!existsSync(dir)) return
  const valid = new Set<string>()
  for (const g of store.state.groups) {
    for (const t of g.tabs) valid.add(t.partition.replace(/^persist:/, ''))
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith('tab-') && !valid.has(name)) {
      try {
        rmSync(join(dir, name), { recursive: true, force: true })
      } catch {
        /* locked dir — retry next launch */
      }
    }
  }
}

function closeTab(tabId: string) {
  const closed = safe(() => store.closeTab(tabId))
  if (!closed) return
  panels.closeForTab(tabId)
  tabs.closeTab(tabId, closed.partitionOrphaned, closed.tab.partition)
  syncShownTab()
}

function deleteGroup(groupId: string) {
  const removed = safe(() => store.deleteGroup(groupId))
  if (!removed) return
  for (const t of removed) {
    panels.closeForTab(t.id)
    tabs.closeTab(t.id, !store.isPartitionInUse(t.partition), t.partition)
  }
  syncShownTab()
}

function togglePanel(tabId: string) {
  const found = safe(() => store.findTab(tabId))
  if (found) panels.toggle(tabId, found.tab.name)
}

function openRealDevtools(tabId: string) {
  panels.detachForDevtools(tabId) // free the CDP slot
  tabs.view(tabId)?.webContents.openDevTools({ mode: 'detach' })
}

/** Ctrl+T / Ctrl+W / Ctrl+L / Ctrl+R / F12 / Ctrl+Shift+F12 — works with focus in page or chrome. */
function wireShortcuts(wc: WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = input.key.toLowerCase()
    const tab = store.activeTab()
    if (ctrl && !input.shift && key === 't') {
      event.preventDefault()
      store.addTab(store.state.activeGroupId)
    } else if (ctrl && key === 'w') {
      event.preventDefault()
      if (tab) closeTab(tab.id)
    } else if (ctrl && key === 'l') {
      event.preventDefault()
      win.webContents.focus()
      win.webContents.send('chrome:focusAddress')
    } else if (key === 'f12' && ctrl && input.shift) {
      event.preventDefault()
      if (tab) openRealDevtools(tab.id)
    } else if (key === 'f12' && !ctrl && !input.shift) {
      event.preventDefault()
      if (tab) togglePanel(tab.id)
    } else if (ctrl && key === 'r') {
      event.preventDefault()
      if (tab) tabs.reload(tab.id)
    }
  })
}

function registerIpc() {
  ipcMain.handle('app:getState', () => store.state)

  ipcMain.handle('group:add', () => {
    store.addGroup()
  })
  ipcMain.handle('group:rename', (_e, id: string, name: string) => {
    safe(() => store.renameGroup(id, name))
  })
  ipcMain.handle('group:delete', (_e, id: string) => deleteGroup(id))
  ipcMain.handle('group:activate', (_e, id: string) => {
    safe(() => store.setActiveGroup(id))
  })

  ipcMain.handle('tab:add', (_e, groupId: string) => {
    safe(() => store.addTab(groupId))
  })
  ipcMain.handle('tab:duplicate', (_e, id: string) => {
    safe(() => store.duplicateTab(id))
  })
  ipcMain.handle('tab:close', (_e, id: string) => closeTab(id))
  ipcMain.handle('tab:rename', (_e, id: string, name: string) => {
    safe(() => store.renameTab(id, name))
  })
  ipcMain.handle('tab:activate', (_e, id: string) => {
    safe(() => store.setActiveTab(id))
  })
  ipcMain.handle('tab:navigate', (_e, id: string, input: string) => {
    safe(() => tabs.navigate(id, normalizeUrl(input)))
  })
  ipcMain.handle('tab:back', (_e, id: string) => {
    tabs.view(id)?.webContents.navigationHistory.goBack()
  })
  ipcMain.handle('tab:forward', (_e, id: string) => {
    tabs.view(id)?.webContents.navigationHistory.goForward()
  })
  ipcMain.handle('tab:reload', (_e, id: string) => {
    safe(() => tabs.reload(id))
  })

  ipcMain.handle('menu:tab', (_e, id: string) => {
    if (!safe(() => store.findTab(id))) return
    Menu.buildFromTemplate([
      { label: 'Duplicate (same session)', click: () => safe(() => store.duplicateTab(id)) },
      { label: 'Rename', click: () => win.webContents.send('chrome:startRename', 'tab', id) },
      { label: 'Close', click: () => closeTab(id) }
    ]).popup({ window: win })
  })
  ipcMain.handle('menu:group', (_e, id: string) => {
    const group = safe(() => store.group(id))
    if (!group) return
    Menu.buildFromTemplate([
      { label: 'Rename', click: () => win.webContents.send('chrome:startRename', 'group', id) },
      {
        label: 'Delete',
        click: async () => {
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Delete', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `Delete group "${group.name}" and all its tabs?`
          })
          if (response === 0) deleteGroup(id)
        }
      }
    ]).popup({ window: win })
  })

  ipcMain.handle('panel:toggle', (_e, id: string) => togglePanel(id))
  ipcMain.handle('panel:init', (_e, tabId: string) => {
    const p = panels.get(tabId)
    return p
      ? { requests: p.capture.log.summaries(), capturing: p.capture.attached }
      : { requests: [], capturing: false }
  })
  ipcMain.handle('panel:detail', (_e, tabId: string, requestId: string) => {
    return panels.get(tabId)?.capture.log.get(requestId) ?? null
  })
  ipcMain.handle('panel:body', (_e, tabId: string, requestId: string) => {
    return panels.get(tabId)?.capture.responseBody(requestId) ?? null
  })
  ipcMain.handle('panel:clear', (_e, tabId: string) => {
    const p = panels.get(tabId)
    if (p) {
      p.capture.log.clear()
      p.win.webContents.send('panel:requests', [])
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14161b', symbolColor: '#d8dbe2', height: 32 },
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.on('closed', () => app.quit())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  store = new AppStore(loadState(stateFile()) ?? undefined)
  cleanOrphanPartitions()
  const scheduleSave = debouncedSaver(stateFile(), () => store.state)

  createWindow()
  tabs = new TabManager(win, store, { wireShortcuts })
  panels = new PanelManager((tabId) => tabs.view(tabId)?.webContents)

  store.onChange = () => {
    syncShownTab()
    pushState()
    scheduleSave()
  }
  registerIpc()
  wireShortcuts(win.webContents)

  win.webContents.on('did-finish-load', () => {
    pushState()
    syncShownTab()
  })
})

app.on('before-quit', () => {
  if (store) {
    try {
      saveState(stateFile(), store.state)
    } catch {
      /* best effort — debounced save already ran */
    }
  }
})
app.on('window-all-closed', () => app.quit())
