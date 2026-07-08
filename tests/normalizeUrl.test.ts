import { describe, expect, it } from 'vitest'
import { normalizeUrl } from '../src/shared/normalizeUrl'

describe('normalizeUrl', () => {
  it('keeps full http/https URLs unchanged', () => {
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('maps a bare port to localhost', () => {
    expect(normalizeUrl('3000')).toBe('http://localhost:3000')
    expect(normalizeUrl(':8080')).toBe('http://localhost:8080')
    expect(normalizeUrl('3000/admin')).toBe('http://localhost:3000/admin')
  })
  it('prefixes bare hosts with http://', () => {
    expect(normalizeUrl('example.com')).toBe('http://example.com')
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
  })
  it('trims whitespace', () => {
    expect(normalizeUrl('  8080 ')).toBe('http://localhost:8080')
  })
  it('passes about:/data: through', () => {
    expect(normalizeUrl('about:blank')).toBe('about:blank')
  })
})
