import type { WebContents } from 'electron'
import { RequestLog } from './requestLog'

/** CDP-based network capture for one tab. Bodies fetched lazily via responseBody(). */
export class NetworkCapture {
  log = new RequestLog()
  attached = false
  onUpdate: () => void = () => {}

  constructor(private wc: WebContents) {}

  private onDetach = () => {
    this.attached = false
  }

  private onDebuggerMessage = (_e: unknown, method: string, params: any) => this.onMessage(method, params)

  /** Returns false when another debugger (e.g. real DevTools) is attached. */
  attach(): boolean {
    if (this.attached) return true
    try {
      this.wc.debugger.attach('1.3')
    } catch {
      return false
    }
    this.attached = true
    this.wc.debugger.removeListener('detach', this.onDetach)
    this.wc.debugger.removeListener('message', this.onDebuggerMessage)
    this.wc.debugger.on('detach', this.onDetach)
    this.wc.debugger.on('message', this.onDebuggerMessage)
    this.wc.debugger.sendCommand('Network.enable').catch(() => {})
    return true
  }

  detach() {
    if (!this.attached) return
    try {
      this.wc.debugger.detach()
    } catch {
      /* already gone */
    }
    this.wc.debugger.removeListener('detach', this.onDetach)
    this.wc.debugger.removeListener('message', this.onDebuggerMessage)
    this.attached = false
  }

  private onMessage(method: string, p: any) {
    if (method === 'Network.requestWillBeSent') {
      // On redirects CDP reuses the requestId and includes the prior leg's
      // response — record it so the log keeps the redirect chain.
      if (p.redirectResponse) {
        this.log.response(p.requestId, p.redirectResponse.status, p.redirectResponse.headers ?? {})
      }
      this.log.start(
        p.requestId,
        p.request.method,
        p.request.url,
        p.type ?? 'Other',
        p.request.headers ?? {},
        p.request.postData ?? null,
        p.timestamp
      )
    } else if (method === 'Network.responseReceived') {
      this.log.response(p.requestId, p.response.status, p.response.headers ?? {})
    } else if (method === 'Network.loadingFinished') {
      this.log.finish(p.requestId, p.timestamp)
    } else if (method === 'Network.loadingFailed') {
      this.log.fail(p.requestId, p.errorText ?? 'failed')
    } else {
      return
    }
    this.onUpdate()
  }

  async responseBody(requestId: string): Promise<string | null> {
    if (!this.attached) return null
    try {
      const { body, base64Encoded } = await this.wc.debugger.sendCommand('Network.getResponseBody', {
        requestId
      })
      return base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
    } catch {
      return null // body no longer buffered, or request had no body
    }
  }
}
