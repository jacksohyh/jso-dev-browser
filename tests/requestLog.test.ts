import { describe, expect, it } from 'vitest'
import { RequestLog } from '../src/main/requestLog'

const start = (log: RequestLog, id: string, url = `http://x/${id}`) =>
  log.start(id, 'GET', url, 'Fetch', { accept: 'application/json' }, null, 100)

describe('RequestLog', () => {
  it('records request -> response -> finish lifecycle', () => {
    const log = new RequestLog()
    log.start('r1', 'POST', 'http://localhost:3000/api/login', 'Fetch', { 'content-type': 'application/json' }, '{"u":"a"}', 100)
    log.response('r1', 200, { 'content-type': 'application/json' })
    log.finish('r1', 100.25)

    const s = log.summaries()
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ id: 'r1', method: 'POST', status: 200, durationMs: 250 })
    expect(s[0]).not.toHaveProperty('requestHeaders')

    const d = log.get('r1')!
    expect(d.requestBody).toBe('{"u":"a"}')
    expect(d.requestHeaders['content-type']).toBe('application/json')
    expect(d.responseHeaders['content-type']).toBe('application/json')
  })

  it('records failures', () => {
    const log = new RequestLog()
    start(log, 'r1')
    log.fail('r1', 'net::ERR_CONNECTION_REFUSED')
    expect(log.summaries()[0].failed).toBe('net::ERR_CONNECTION_REFUSED')
  })

  it('evicts oldest beyond the cap', () => {
    const log = new RequestLog(3)
    for (const id of ['a', 'b', 'c', 'd']) start(log, id)
    expect(log.summaries().map((r) => r.id)).toEqual(['b', 'c', 'd'])
    expect(log.get('a')).toBeUndefined()
  })

  it('ignores events for unknown/evicted requests', () => {
    const log = new RequestLog()
    log.response('nope', 200, {})
    log.finish('nope', 1)
    log.fail('nope', 'x')
    expect(log.summaries()).toHaveLength(0)
  })

  it('clear empties the log', () => {
    const log = new RequestLog()
    start(log, 'r1')
    log.clear()
    expect(log.summaries()).toHaveLength(0)
  })
})
