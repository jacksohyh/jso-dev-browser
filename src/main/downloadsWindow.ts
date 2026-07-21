import { BrowserWindow } from 'electron'
import { join } from 'node:path'

const WIDTH = 380
const HEIGHT = 440
/** Height of the chrome rows the popup should hang below (matches CHROME_HEIGHT). */
const CHROME_TOP = 96

/**
 * A dropdown-style downloads popup anchored to the main window's top-right,
 * just under the toolbar. A real top-level window (not chrome DOM) so it draws
 * cleanly over the page's WebContentsView. Hides on blur for a menu-like feel.
 */
export class DownloadsWindow {
  private win: BrowserWindow | null = null
  private lastHide = 0

  constructor(private parent: () => BrowserWindow) {}

  /** Toggle visibility; a click that blurred the popup shut counts as "close". */
  toggle(): void {
    const visible = this.win && !this.win.isDestroyed() && this.win.isVisible()
    if (visible) {
      this.win!.hide()
      return
    }
    if (Date.now() - this.lastHide < 250) return // same click that blur-closed it
    this.ensure()
    this.reposition()
    this.win!.show()
    this.win!.focus()
  }

  private ensure(): void {
    if (this.win && !this.win.isDestroyed()) return
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      parent: this.parent(),
      frame: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    this.win.on('blur', () => {
      this.lastHide = Date.now()
      this.win?.hide()
    })
    this.win.on('closed', () => (this.win = null))
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/downloads.html`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/downloads.html'))
    }
  }

  private reposition(): void {
    if (!this.win) return
    const b = this.parent().getBounds()
    const x = b.x + b.width - WIDTH - 12
    const y = b.y + CHROME_TOP + 4
    this.win.setPosition(Math.round(x), Math.round(y))
  }
}
