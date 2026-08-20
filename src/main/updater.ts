import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Auto-update from GitHub Releases (electron-updater + the latest.yml that
 * electron-builder publishes). Installed (NSIS) Windows builds only:
 * - dev runs have nothing to update;
 * - the portable exe extracts itself to temp and cannot replace itself;
 * - unsigned macOS builds can't use Squirrel.Mac, so mac is out until signing.
 *
 * Flow: check on launch → download in the background → offer a restart.
 * If the user picks "Later", the update still applies on the next quit.
 */
export function initAutoUpdate(win: BrowserWindow, onQuitForUpdate: () => void): void {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR || process.platform !== 'win32') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', async (info) => {
    if (win.isDestroyed()) return
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Update ${info.version} ready`,
      detail: 'Downloaded in the background. Restart to apply — or pick Later and it applies on your next launch.'
    })
    if (response === 0) {
      // quitAndInstall closes windows BEFORE before-quit fires, so flag the
      // unsaved-changes bypass first or a page's beforeunload could block it.
      onQuitForUpdate()
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', () => {
    /* offline or GitHub hiccup — silent; we try again next launch */
  })

  autoUpdater.checkForUpdates().catch(() => {})
}
