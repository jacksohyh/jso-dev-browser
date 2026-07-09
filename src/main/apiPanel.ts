import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import { NetworkCapture } from './capture'
import type { RequestSummary } from '../shared/types'

export interface ActiveTab {
  id: string
  name: string
}
export interface PanelState {
  tabId: string | null
  tabName: string
  capturing: boolean
  requests: RequestSummary[]
}

/**
 * Owns per-tab network captures (decoupled from the window) and a single
 * "Network" panel window that always shows the ACTIVE tab's capture.
 */
export class PanelManager {
  private captures = new Map<string, NetworkCapture>()
  private win: BrowserWindow | null = null
  private shownTabId: string | null = null
  private shownTabName = ''
  private throttle: NodeJS.Timeout | null = null
  alwaysCapture = false

  constructor(private getTabWebContents: (tabId: string) => WebContents | undefined) {}

  /** Attach a capture for a tab if not already present. Returns it (or null if the tab has no webContents). */
  ensureCapture(tabId: string): NetworkCapture | null {
    const existing = this.captures.get(tabId)
    if (existing) {
      if (!existing.attached) existing.attach()
      return existing
    }
    const wc = this.getTabWebContents(tabId)
    if (!wc) return null
    const capture = new NetworkCapture(wc)
    capture.attach()
    this.captures.set(tabId, capture)
    return capture
  }

  stopCapture(tabId: string) {
    const c = this.captures.get(tabId)
    if (c) {
      c.onUpdate = () => {}
      c.detach()
      this.captures.delete(tabId)
    }
  }

  captureFor(tabId: string): NetworkCapture | undefined {
    return this.captures.get(tabId)
  }

  isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  /** alwaysCapture flip: on -> capture every given (viewed) tab; off -> stop all except the shown one. */
  setAlwaysCapture(on: boolean, viewedTabIds: string[]) {
    this.alwaysCapture = on
    if (on) {
      for (const id of viewedTabIds) this.ensureCapture(id)
    } else {
      for (const id of [...this.captures.keys()]) {
        if (id !== this.shownTabId) this.stopCapture(id)
      }
    }
  }

  /** Toggle the single Network window. */
  toggle(active: ActiveTab | null) {
    if (this.isOpen()) {
      this.win!.close()
      return
    }
    this.win = new BrowserWindow({
      width: 760,
      height: 520,
      title: 'Network',
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    this.win.on('closed', () => {
      const prev = this.shownTabId
      this.win = null
      this.shownTabId = null
      this.shownTabName = ''
      if (prev && !this.alwaysCapture) this.stopCapture(prev)
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/panel.html'))
    }
    this.win.webContents.once('did-finish-load', () => this.bind(active, true))
  }

  /** Point the panel at a tab (the active one). Idempotent for the same tab unless force. */
  bind(active: ActiveTab | null, force = false) {
    if (!this.isOpen()) return
    if (!force && active?.id === this.shownTabId) return
    if (this.shownTabId && this.shownTabId !== active?.id) {
      const prev = this.captures.get(this.shownTabId)
      if (prev) prev.onUpdate = () => {}
      if (!this.alwaysCapture) this.stopCapture(this.shownTabId)
    }
    this.shownTabId = active?.id ?? null
    this.shownTabName = active?.name ?? ''
    if (active) {
      const cap = this.ensureCapture(active.id)
      if (cap) cap.onUpdate = () => this.scheduleBroadcast()
    }
    this.pushState()
  }

  private scheduleBroadcast() {
    if (this.throttle) return
    this.throttle = setTimeout(() => {
      this.throttle = null
      this.pushState()
    }, 100)
  }

  private stateNow(): PanelState {
    const cap = this.shownTabId ? this.captures.get(this.shownTabId) : undefined
    return {
      tabId: this.shownTabId,
      tabName: this.shownTabName,
      capturing: cap?.attached ?? false,
      requests: cap ? cap.log.summaries() : []
    }
  }

  private pushState() {
    if (this.isOpen()) this.win!.webContents.send('panel:state', this.stateNow())
  }

  currentState(): PanelState {
    return this.stateNow()
  }

  clearShown() {
    if (this.shownTabId) this.captures.get(this.shownTabId)?.log.clear()
    this.pushState()
  }

  detailForShown(requestId: string) {
    return this.shownTabId ? (this.captures.get(this.shownTabId)?.log.get(requestId) ?? null) : null
  }

  bodyForShown(requestId: string): Promise<string | null> {
    const cap = this.shownTabId ? this.captures.get(this.shownTabId) : undefined
    return cap ? cap.responseBody(requestId) : Promise.resolve(null)
  }

  closeForTab(tabId: string) {
    this.stopCapture(tabId)
    if (this.shownTabId === tabId) {
      this.shownTabId = null
      this.shownTabName = ''
      this.pushState()
    }
  }

  detachForDevtools(tabId: string) {
    this.captures.get(tabId)?.detach()
    if (this.shownTabId === tabId) this.pushState()
  }
}
