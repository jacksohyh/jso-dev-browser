import type { RequestSummary } from '../shared/types'

export interface StoredRequest extends RequestSummary {
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string>
  startTs: number // CDP timestamp, seconds
}

/** Insertion-ordered map capped at `cap`; oldest entries evicted. */
export class RequestLog {
  private byId = new Map<string, StoredRequest>()

  constructor(private cap = 500) {}

  start(
    id: string,
    method: string,
    url: string,
    resourceType: string,
    requestHeaders: Record<string, string>,
    requestBody: string | null,
    ts: number
  ) {
    const existing = this.byId.get(id)
    if (existing) {
      // CDP reuses the requestId on redirects — keep the chain instead of overwriting.
      existing.redirects = [...(existing.redirects ?? []), { url: existing.url, status: existing.status }]
      existing.method = method
      existing.url = url
      existing.requestHeaders = requestHeaders
      existing.requestBody = requestBody
      existing.status = null
      existing.responseHeaders = {}
      // startTs intentionally kept from the first leg so durationMs spans the whole chain
      return
    }
    this.byId.set(id, {
      id,
      method,
      url,
      resourceType,
      status: null,
      durationMs: null,
      requestHeaders,
      requestBody,
      responseHeaders: {},
      startTs: ts
    })
    if (this.byId.size > this.cap) {
      const oldest = this.byId.keys().next().value as string
      this.byId.delete(oldest)
    }
  }

  response(id: string, status: number, responseHeaders: Record<string, string>) {
    const e = this.byId.get(id)
    if (e) {
      e.status = status
      e.responseHeaders = responseHeaders
    }
  }

  finish(id: string, ts: number) {
    const e = this.byId.get(id)
    if (e) e.durationMs = Math.round((ts - e.startTs) * 1000)
  }

  fail(id: string, errorText: string) {
    const e = this.byId.get(id)
    if (e) e.failed = errorText
  }

  get(id: string): StoredRequest | undefined {
    return this.byId.get(id)
  }

  summaries(): RequestSummary[] {
    return [...this.byId.values()].map(
      ({ requestHeaders, requestBody, responseHeaders, startTs, ...summary }) => summary
    )
  }

  clear() {
    this.byId.clear()
  }
}
