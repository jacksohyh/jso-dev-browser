import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron'
import type { WebContents } from 'electron'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeUrl } from '../shared/normalizeUrl'
import { PanelManager } from './apiPanel'
import { AppStore } from './state'
import { debouncedSaver, loadState, saveState } from './stateFile'
import { TabManager } from './tabs'
import { Vault } from './vault'
import { registerAutofill } from './autofillBridge'
import { SettingsWindow } from './settingsWindow'

let win: BrowserWindow
let store: AppStore
let tabs: TabManager
let panels: PanelManager
let settings: SettingsWindow | undefined
let vault: Vault
let saveQueue: { origin: string; username: string; password: string }[] = []

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

function activeTabInfo(): { id: string; name: string } | null {
  const t = store.activeTab()
  return t ? { id: t.id, name: t.name } : null
}

const SAVE_PROMPT_HEIGHT = 38
const FIND_BAR_HEIGHT = 34
const chromeExtras = { save: 0, find: 0 }
function applyChromeExtra() {
  tabs.setExtraOffset(chromeExtras.save + chromeExtras.find)
}

function promptNextSave() {
  chromeExtras.save = saveQueue.length > 0 ? SAVE_PROMPT_HEIGHT : 0
  applyChromeExtra()
  const next = saveQueue[0]
  if (next && win && !win.isDestroyed()) {
    win.webContents.send('chrome:savePrompt', { origin: next.origin, username: next.username })
  }
}

function applyZoom(level: number) {
  store.setZoom(level) // clamps + guards + emits (persist via onChange)
  tabs.setZoomAll(store.state.zoom)
  settings?.pushZoom(store.state.zoom)
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

function togglePanel() {
  panels.toggle(activeTabInfo())
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
      togglePanel()
    } else if (ctrl && !input.shift && key === 'f') {
      event.preventDefault()
      chromeExtras.find = FIND_BAR_HEIGHT
      applyChromeExtra()
      win.webContents.send('chrome:find')
    } else if (ctrl && key === 'r') {
      event.preventDefault()
      if (tab) tabs.reload(tab.id)
    } else if (ctrl && (key === '=' || key === '+')) {
      event.preventDefault()
      applyZoom(store.state.zoom + 0.5)
    } else if (ctrl && key === '-') {
      event.preventDefault()
      applyZoom(store.state.zoom - 0.5)
    } else if (ctrl && key === '0') {
      event.preventDefault()
      applyZoom(0)
    } else if (ctrl && key === 'tab') {
      event.preventDefault()
      if (input.shift) store.nextGroup()
      else store.nextTab()
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
  ipcMain.handle('group:setWidth', (_e, id: string, width: number) => {
    safe(() => store.setGroupWidth(id, width))
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
      { label: 'Adjust width', click: () => win.webContents.send('chrome:startAdjust', id) },
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

  ipcMain.handle('panel:toggle', () => togglePanel())
  ipcMain.handle('panel:init', () => panels.currentState())
  ipcMain.handle('panel:detail', (_e, requestId: string) => panels.detailForShown(requestId))
  ipcMain.handle('panel:body', (_e, requestId: string) => panels.bodyForShown(requestId))
  ipcMain.handle('panel:clear', () => panels.clearShown())

  ipcMain.handle('capture:get', () => store.state.alwaysCapture)
  ipcMain.handle('capture:set', (_e, on: boolean) => {
    store.setAlwaysCapture(on)
    panels.setAlwaysCapture(on, tabs.viewedTabIds())
  })

  ipcMain.handle('settings:open', () => settings?.open())
  ipcMain.handle('save:decide', (_e, accept: boolean) => {
    const current = saveQueue.shift()
    if (accept && current) vault.add(current.origin, current.username, current.password)
    promptNextSave()
  })
  ipcMain.handle('find:query', (_e, text: string, forward: boolean, findNext: boolean) => {
    const t = store.activeTab()
    const wc = t ? tabs.view(t.id)?.webContents : undefined
    if (!wc) return
    if (!text) wc.stopFindInPage('clearSelection')
    else wc.findInPage(text, { forward, findNext })
  })
  ipcMain.handle('find:stop', () => {
    const t = store.activeTab()
    const wc = t ? tabs.view(t.id)?.webContents : undefined
    wc?.stopFindInPage('clearSelection')
    chromeExtras.find = 0
    applyChromeExtra()
  })
  ipcMain.handle('save:never', () => {
    const current = saveQueue.shift()
    if (current) {
      vault.never(current.origin)
      // Drop any other queued prompts for the same origin the user just silenced.
      saveQueue = saveQueue.filter((d) => d.origin !== current.origin)
    }
    promptNextSave()
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
  panels = new PanelManager((tabId) => tabs.view(tabId)?.webContents)
  panels.alwaysCapture = store.state.alwaysCapture
  const onViewReady = (tabId: string) => {
    if (store.state.alwaysCapture) panels.ensureCapture(tabId)
  }
  tabs = new TabManager(win, store, { wireShortcuts, onViewReady })

  vault = new Vault(join(app.getPath('userData'), 'passwords.json'), safeStorage)
  settings = new SettingsWindow(
    vault,
    () => store.state.zoom,
    (level) => applyZoom(level)
  )
  registerAutofill(vault, (data) => {
    saveQueue.push(data)
    if (saveQueue.length === 1) promptNextSave()
  })

  tabs.onZoomStep = (delta) => applyZoom(store.state.zoom + delta)
  tabs.setZoomAll(store.state.zoom) // apply persisted zoom to any views

  store.onChange = () => {
    syncShownTab()
    if (panels.isOpen()) panels.bind(activeTabInfo())
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
