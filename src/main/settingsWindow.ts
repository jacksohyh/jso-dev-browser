import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { Vault } from './vault'

/** Single-instance settings window; talks to the Vault and pushes zoom updates. */
export class SettingsWindow {
  private win: BrowserWindow | null = null

  constructor(
    private vault: Vault,
    private getZoom: () => number,
    private onSetZoom: (level: number) => void
  ) {
    ipcMain.handle('settings:list', () => this.snapshot())
    ipcMain.handle('settings:reveal', (_e, id: string) => this.vault.get(id))
    ipcMain.handle('settings:delete', (_e, id: string) => {
      this.vault.remove(id)
      return this.snapshot()
    })
    ipcMain.handle('settings:setZoom', (_e, level: number) => {
      this.onSetZoom(level)
    })
    ipcMain.handle('settings:getZoom', () => this.getZoom())
  }

  private snapshot() {
    return {
      origins: this.vault.allOrigins().map((origin) => ({
        origin,
        logins: this.vault.list(origin)
      })),
      available: this.vault.available
    }
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus()
      return
    }
    this.win = new BrowserWindow({
      width: 560,
      height: 560,
      title: 'Settings',
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    this.win.on('closed', () => (this.win = null))
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/settings.html'))
    }
  }

  pushZoom(level: number) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('settings:zoom', level)
  }
}
