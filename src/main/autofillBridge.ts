import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { Vault } from './vault'

/** The true origin of the frame that sent the IPC — never trust a renderer-supplied origin string. */
function senderOrigin(e: IpcMainInvokeEvent | IpcMainEvent): string | null {
  try {
    const url = e.senderFrame?.url
    return url ? new URL(url).origin : null
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
    const origin = senderOrigin(e)
    return origin ? vault.list(origin) : []
  })

  ipcMain.handle('autofill:secret', (e: IpcMainInvokeEvent, id: string) => {
    const origin = senderOrigin(e)
    if (!origin) return null
    // Only release the secret if this id belongs to the caller's own origin.
    return vault.list(origin).some((l) => l.id === id) ? vault.get(id) : null
  })

  ipcMain.on('autofill:captured', (e: IpcMainEvent, data: { username?: string; password?: string }) => {
    const origin = senderOrigin(e)
    if (!origin || !data || !data.password) return
    if (vault.isNever(origin)) return
    const username = data.username ?? ''
    const existing = vault.list(origin).find((l) => l.username === username)
    if (existing && vault.get(existing.id) === data.password) return // identical, already saved
    onCapture({ origin, username, password: data.password })
  })
}
