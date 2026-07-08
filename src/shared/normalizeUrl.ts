/** Turns address-bar input into a loadable URL. Bare ports go to localhost. */
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (/^(about|data|file):/i.test(s)) return s
  const port = s.match(/^:?(\d{2,5})(\/.*)?$/)
  if (port) return `http://localhost:${port[1]}${port[2] ?? ''}`
  return `http://${s}`
}
