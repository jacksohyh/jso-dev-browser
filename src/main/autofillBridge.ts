import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { Vault } from './vault'

/**
 * The origin of the SENDER — but only for the top-level document. Subframes
 * (including cross-origin iframes of a site you have creds for) return null,
 * so autofill never operates inside an embedded frame. This is the trust
 * boundary: enforced in the main process, not the renderer.
 */
function topFrameOrigin(e: IpcMainInvokeEvent | IpcMainEvent): string | null {
  const frame = e.senderFrame
  if (!frame || frame.parent !== null) return null
  try {
    return new URL(frame.url).origin
  } catch {
    return null
  }
}

/**
 * Wires the injected autofill preload to the Vault.
 * onCapture fires when a login is submitted and is not already known/ignored,
 * so the caller can show the save prompt in the chrome UI.
 * Security: query/secret/capture all use the SENDER's real origin. A page can only
 * ever see or fill its own origin's logins; autofill:secret refuses an id that does
 * not belong to the caller's origin, so a compromised page can't enumerate others' ids.
 */
export function registerAutofill(
  vault: Vault,
  _getChromeWindow: () => BrowserWindow,
  onCapture: (data: { origin: string; username: string; password: string }) => void
) {
  ipcMain.handle('autofill:query', (e: IpcMainInvokeEvent) => {
    const origin = topFrameOrigin(e)
    return origin ? vault.list(origin) : []
  })

  ipcMain.handle('autofill:secret', (e: IpcMainInvokeEvent, id: string) => {
    const origin = topFrameOrigin(e)
    if (!origin) return null
    // Only release the secret if this id belongs to the caller's own origin.
    return vault.list(origin).some((l) => l.id === id) ? vault.get(id) : null
  })

  ipcMain.on('autofill:captured', (e: IpcMainEvent, data: { username?: string; password?: string }) => {
    const origin = topFrameOrigin(e)
    if (!origin || !data || !data.password) return
    if (vault.isNever(origin)) return
    const username = data.username ?? ''
    const existing = vault.list(origin).find((l) => l.username === username)
    if (existing && vault.get(existing.id) === data.password) return // identical, already saved
    onCapture({ origin, username, password: data.password })
  })
}
