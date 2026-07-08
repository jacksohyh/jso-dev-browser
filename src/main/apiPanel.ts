import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import { NetworkCapture } from './capture'

interface PanelEntry {
  win: BrowserWindow
  capture: NetworkCapture
}

/** One floating API-panel window + network capture per tab. */
export class PanelManager {
  private panels = new Map<string, PanelEntry>()

  constructor(private getTabWebContents: (tabId: string) => WebContents | undefined) {}

  get(tabId: string): PanelEntry | undefined {
    return this.panels.get(tabId)
  }

  /** Open the panel for a tab, or close it if already open. */
  toggle(tabId: string, tabName: string) {
    const existing = this.panels.get(tabId)
    if (existing) {
      existing.win.close() // 'closed' handler cleans up
      return
    }
    const wc = this.getTabWebContents(tabId)
    if (!wc) return

    const capture = new NetworkCapture(wc)
    const capturing = capture.attach()

    const win = new BrowserWindow({
      width: 760,
      height: 520,
      title: `API — ${tabName}`,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    const query = { tabId, capturing: String(capturing) }
    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html?tabId=${tabId}&capturing=${capturing}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/panel.html'), { query })
    }

    let timer: NodeJS.Timeout | null = null
    capture.onUpdate = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (!win.isDestroyed()) win.webContents.send('panel:requests', capture.log.summaries())
      }, 100)
    }

    win.on('closed', () => {
      capture.detach()
      this.panels.delete(tabId)
    })
    this.panels.set(tabId, { win, capture })
  }

  closeForTab(tabId: string) {
    this.panels.get(tabId)?.win.close()
  }

  /** Real DevTools needs the CDP slot — pause our capture for this tab. */
  detachForDevtools(tabId: string) {
    this.panels.get(tabId)?.capture.detach()
  }
}
