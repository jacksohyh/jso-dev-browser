import { app, BrowserWindow, shell } from 'electron'
import type { DownloadItem, Session } from 'electron'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DownloadRecord } from '../shared/types'

/**
 * Tracks downloads across every partition session and broadcasts their progress
 * to the chrome + downloads windows. Files auto-save to the OS Downloads folder
 * (deduped) with no Save-As dialog — the visibility (progress, done/failed,
 * open/show) lives in the downloads panel instead.
 */
export class DownloadManager {
  private records: DownloadRecord[] = [] // newest first
  private items = new Map<string, DownloadItem>() // live items, for cancel
  private attached = new WeakSet<Session>()
  private seq = 0
  private pushTimer: NodeJS.Timeout | null = null

  /** Attach the will-download listener to a partition session (once). */
  attach(ses: Session): void {
    if (this.attached.has(ses)) return
    this.attached.add(ses)
    ses.on('will-download', (_e, item) => this.track(item))
  }

  private uniquePath(dir: string, filename: string): string {
    const safe = filename || 'download'
    let candidate = join(dir, safe)
    if (!existsSync(candidate)) return candidate
    const ext = extname(safe)
    const base = basename(safe, ext)
    let n = 1
    do {
      candidate = join(dir, `${base} (${n})${ext}`)
      n++
    } while (existsSync(candidate))
    return candidate
  }

  private track(item: DownloadItem): void {
    const id = `dl-${++this.seq}`
    const savePath = this.uniquePath(app.getPath('downloads'), item.getFilename())
    item.setSavePath(savePath) // auto-save, no dialog — must be set synchronously here
    this.items.set(id, item)

    const rec: DownloadRecord = {
      id,
      filename: basename(savePath),
      url: item.getURL(),
      savePath,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now()
    }
    this.records.unshift(rec)
    if (this.records.length > 100) this.records.length = 100

    item.on('updated', (_e, state) => {
      rec.receivedBytes = item.getReceivedBytes()
      rec.totalBytes = item.getTotalBytes()
      rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.schedulePush()
    })
    item.on('done', (_e, state) => {
      rec.receivedBytes = item.getReceivedBytes()
      rec.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.items.delete(id)
      this.push()
    })
    this.push()
  }

  /** Coalesce rapid progress ticks into ~one push per 150ms. */
  private schedulePush(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.push()
    }, 150)
  }

  private push(): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('downloads:state', this.records)
    }
  }

  list(): DownloadRecord[] {
    return this.records
  }

  cancel(id: string): void {
    this.items.get(id)?.cancel()
  }

  open(id: string): void {
    const rec = this.records.find((r) => r.id === id)
    if (rec?.state === 'completed') shell.openPath(rec.savePath)
  }

  show(id: string): void {
    const rec = this.records.find((r) => r.id === id)
    if (rec) shell.showItemInFolder(rec.savePath)
  }

  /** Drop finished entries; leave in-progress ones alone. */
  clearFinished(): void {
    this.records = this.records.filter((r) => r.state === 'progressing' || r.state === 'paused')
    this.push()
  }
}
