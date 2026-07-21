import { BrowserWindow, dialog, WebContentsView, session } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import type { TabInfo } from '../shared/types'
import type { AppStore } from './state'

/** Total height of the chrome UI rows (groups 32 + tabs 32 + address 32). */
export const CHROME_HEIGHT = 96

export function errorPageUrl(failedUrl: string, description: string): string {
  const html = `<body style="margin:0;font-family:system-ui,sans-serif;background:#1b1e24;color:#d8dbe2;display:grid;place-items:center;height:100vh">
    <div style="text-align:center">
      <h2 style="margin:0 0 8px">Could not load</h2>
      <p style="margin:4px;color:#9aa0ab">${failedUrl.replace(/</g, '&lt;')}</p>
      <p style="margin:4px;color:#e06c75">${description.replace(/</g, '&lt;')}</p>
      <p style="margin-top:16px;color:#9aa0ab">Press the reload button (or Ctrl+R) to retry.</p>
    </div>
  </body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export interface TabManagerEvents {
  wireShortcuts: (wc: WebContents) => void
  onViewReady?: (tabId: string) => void
  /** Restore persisted session cookies into the partition; resolves before the tab loads. */
  prepareSession?: (partition: string) => Promise<void>
}

export class TabManager {
  // Views stay alive until their tab closes (keep-warm, like Chrome); many open
  // tabs therefore hold many renderer processes — deliberate trade-off for a dev tool.
  private views = new Map<string, WebContentsView>()
  private shownTabId: string | null = null
  private zoom = 0
  private extraOffset = 0
  /** Set on app quit so unsaved-changes prompts don't block shutdown. */
  quitting = false
  onZoomStep?: (delta: number) => void

  constructor(
    private win: BrowserWindow,
    private store: AppStore,
    private events: TabManagerEvents
  ) {
    win.on('resize', () => this.layout())
  }

  view(tabId: string): WebContentsView | undefined {
    return this.views.get(tabId)
  }

  viewedTabIds(): string[] {
    return [...this.views.keys()]
  }

  setZoomAll(level: number) {
    this.zoom = level
    for (const view of this.views.values()) view.webContents.setZoomLevel(level)
  }

  private openTab(tab: TabInfo): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload: join(__dirname, '../preload/autofill-preload.js')
      }
    })
    this.views.set(tab.id, view)
    const wc = view.webContents
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Middle-click / ctrl-click ('background-tab') and target=_blank
      // ('foreground-tab') should become a tab in OUR chrome sharing this tab's
      // session — not a native popup window. Matches Chrome.
      if (disposition === 'background-tab' || disposition === 'foreground-tab') {
        if (url && url !== 'about:blank') {
          this.store.openLinkTab(tab.id, url, { background: disposition === 'background-tab' })
        }
        return { action: 'deny' }
      }
      // window.open with features ('new-window') stays a real popup so OAuth /
      // sign-in flows keep their window.opener callback. Child windows inherit
      // this webContents' session, so cookies stay in the tab's partition.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true }
      }
    })
    wc.on('page-title-updated', (_e, title) => this.store.setTabTitle(tab.id, title))
    wc.on('did-navigate', (_e, url) => {
      if (!url.startsWith('data:')) this.store.setTabUrl(tab.id, url)
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      if (!url.startsWith('data:')) this.store.setTabUrl(tab.id, url)
    })
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      // -3 = ERR_ABORTED (normal during quick re-navigation) — not an error
      if (isMainFrame && code !== -3) wc.loadURL(errorPageUrl(failedUrl, `${desc} (${code})`))
    })
    wc.on('found-in-page', (_e, result) => {
      this.win.webContents.send('find:result', {
        active: result.activeMatchOrdinal,
        total: result.matches
      })
    })
    // A page's beforeunload handler (e.g. an unsaved-changes guard) fires this.
    // Without a handler, Electron silently CANCELS the reload/navigation — so we
    // show the standard "leave page?" confirm and allow it if the user agrees.
    wc.on('will-prevent-unload', (event) => {
      if (this.quitting) {
        event.preventDefault() // allow unload — don't block app shutdown
        return
      }
      const choice = dialog.showMessageBoxSync(this.win, {
        type: 'question',
        buttons: ['Leave', 'Stay'],
        defaultId: 0,
        cancelId: 1,
        title: 'Leave this page?',
        message: 'Leave this page?',
        detail: 'Changes you made may not be saved.'
      })
      if (choice === 0) event.preventDefault() // preventDefault here = proceed with unload
    })
    wc.on('did-start-loading', () => this.emitLoading(tab.id, true))
    wc.on('did-stop-loading', () => this.emitLoading(tab.id, false))
    wc.on('did-finish-load', () => wc.setZoomLevel(this.zoom))
    wc.on('zoom-changed', (_e, dir: 'in' | 'out') => {
      this.onZoomStep?.(dir === 'in' ? 0.5 : -0.5)
    })
    this.events.wireShortcuts(wc)
    this.events.onViewReady?.(tab.id)
    // Restore this partition's session cookies BEFORE the first navigation so the
    // opening request carries any saved login token; otherwise load immediately.
    const load = (): void => {
      if (tab.url && tab.url !== 'about:blank') wc.loadURL(tab.url)
    }
    const prep = this.events.prepareSession?.(tab.partition)
    if (prep) prep.then(load, load)
    else load()
    return view
  }

  /** Attach the tab's view (creating it lazily), detaching the previous one. */
  showTab(tabId: string) {
    if (this.shownTabId === tabId) return
    if (this.shownTabId) {
      const prev = this.views.get(this.shownTabId)
      if (prev) this.win.contentView.removeChildView(prev)
    }
    const { tab } = this.store.findTab(tabId)
    const view = this.views.get(tabId) ?? this.openTab(tab)
    this.win.contentView.addChildView(view)
    this.shownTabId = tabId
    this.layout()
  }

  hideCurrent() {
    if (!this.shownTabId) return
    const v = this.views.get(this.shownTabId)
    if (v) this.win.contentView.removeChildView(v)
    this.shownTabId = null
  }

  /** Destroy the view; when the session is orphaned, wipe its on-disk storage. */
  closeTab(tabId: string, clearSession: boolean, partition: string) {
    const view = this.views.get(tabId)
    const wipe = clearSession
      ? () => {
          session
            .fromPartition(partition)
            .clearStorageData()
            .catch(() => {})
        }
      : null
    if (view) {
      if (this.shownTabId === tabId) {
        this.win.contentView.removeChildView(view)
        this.shownTabId = null
      }
      // Wipe after teardown so the closing page can't write cookies behind us.
      if (wipe) view.webContents.once('destroyed', wipe)
      view.webContents.close()
      this.views.delete(tabId)
    } else if (wipe) {
      wipe()
    }
  }

  private emitLoading(tabId: string, loading: boolean) {
    if (!this.win.isDestroyed()) this.win.webContents.send('tab:loading', { id: tabId, loading })
  }

  navigate(tabId: string, url: string) {
    this.store.setTabUrl(tabId, url)
    const view = this.views.get(tabId)
    if (view) view.webContents.loadURL(url)
  }

  /** Stop the in-progress load for a tab (the ⟳→✕ stop button). */
  stop(tabId: string) {
    this.views.get(tabId)?.webContents.stop()
  }

  /** Reload; if we're on the inline error page, retry the tab's real URL instead. */
  reload(tabId: string) {
    const view = this.views.get(tabId)
    if (!view) return
    const { tab } = this.store.findTab(tabId)
    if (view.webContents.getURL().startsWith('data:')) view.webContents.loadURL(tab.url)
    else view.webContents.reload()
  }

  layout() {
    if (!this.shownTabId) return
    const view = this.views.get(this.shownTabId)
    if (!view) return
    const [w, h] = this.win.getContentSize()
    const top = CHROME_HEIGHT + this.extraOffset
    view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) })
  }

  /** Push the page view down by `px` (used to reveal the save-password bar below the address row). */
  setExtraOffset(px: number) {
    if (this.extraOffset === px) return
    this.extraOffset = px
    this.layout()
  }
}
