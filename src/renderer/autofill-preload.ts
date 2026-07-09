import { ipcRenderer } from 'electron'

function originOf(): string {
  return location.origin
}

// Autofill runs only in the top-level document; subframes stay inert.
const isTopFrame = window.top === window

// --- Save capture: catch logins via submit, button-click, or Enter ---
let lastSentKey = ''
let lastSentAt = 0

function usernameNear(pw: HTMLInputElement): string {
  const form = pw.closest('form')
  const scope: ParentNode = form ?? document
  const fields = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[]
  const pwIdx = fields.indexOf(pw)
  for (let i = pwIdx - 1; i >= 0; i--) {
    const t = (fields[i].type || '').toLowerCase()
    if (t === 'text' || t === 'email' || fields[i].autocomplete === 'username') return fields[i].value
  }
  const named = scope.querySelector<HTMLInputElement>('input[autocomplete="username"], input[type="email"]')
  return named?.value ?? ''
}

function capture(pw: HTMLInputElement | null | undefined) {
  if (!pw || !pw.value) return
  const username = usernameNear(pw)
  const key = username + ' ' + pw.value
  const now = Date.now()
  if (key === lastSentKey && now - lastSentAt < 2000) return // dedupe submit+click double-fire
  lastSentKey = key
  lastSentAt = now
  ipcRenderer.send('autofill:captured', { origin: location.origin, username, password: pw.value })
}

if (isTopFrame) {
  // 1) native form submit
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target
      if (form instanceof HTMLFormElement) capture(form.querySelector<HTMLInputElement>('input[type="password"]'))
    },
    true
  )
  // 2) click on a submit-like control while a password field is filled (SPA logins)
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as HTMLElement
      const btn = el && el.closest ? el.closest('button, [type="submit"], [role="button"], a') : null
      if (!btn) return
      const scope = (btn.closest('form') as ParentNode) ?? document
      capture(scope.querySelector<HTMLInputElement>('input[type="password"]'))
    },
    true
  )
  // 3) Enter pressed inside a password field
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter') return
      const el = e.target
      if (el instanceof HTMLInputElement && el.type === 'password') capture(el)
    },
    true
  )
}

let dropdown: HTMLElement | null = null

function removeDropdown() {
  dropdown?.remove()
  dropdown = null
}

function showDropdown(target: HTMLInputElement, logins: { id: string; username: string }[]) {
  removeDropdown()
  const host = document.createElement('div')
  host.style.position = 'absolute'
  const rect = target.getBoundingClientRect()
  host.style.left = `${window.scrollX + rect.left}px`
  host.style.top = `${window.scrollY + rect.bottom}px`
  host.style.zIndex = '2147483647'
  const shadow = host.attachShadow({ mode: 'open' })
  const box = document.createElement('div')
  box.style.cssText =
    'font:13px system-ui,sans-serif;background:#262b33;color:#d8dbe2;border:1px solid #3a4150;border-radius:6px;min-width:180px;box-shadow:0 4px 16px #0008;overflow:hidden'
  for (const login of logins) {
    const item = document.createElement('div')
    item.textContent = login.username
    item.style.cssText = 'padding:6px 10px;cursor:pointer'
    item.addEventListener('mousedown', async (ev) => {
      ev.preventDefault()
      const password = await ipcRenderer.invoke('autofill:secret', login.id)
      if (password != null) fillInto(target, login.username, password)
      removeDropdown()
    })
    item.addEventListener('mouseenter', () => (item.style.background = '#2e3440'))
    item.addEventListener('mouseleave', () => (item.style.background = 'transparent'))
    box.appendChild(item)
  }
  shadow.appendChild(box)
  document.body.appendChild(host)
  dropdown = host
}

function fillInto(field: HTMLInputElement, username: string, password: string) {
  const form = field.closest('form')
  const pw = form?.querySelector<HTMLInputElement>('input[type="password"]')
  const userField =
    field.type === 'password'
      ? form?.querySelector<HTMLInputElement>('input[type="text"],input[type="email"],input[autocomplete="username"]')
      : field
  const setValue = (el: HTMLInputElement | null | undefined, val: string) => {
    if (!el) return
    el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  setValue(userField ?? null, username)
  setValue(pw ?? null, password)
}

let cachedLogins: { id: string; username: string }[] = []

async function refreshLogins() {
  try {
    cachedLogins = await ipcRenderer.invoke('autofill:query', originOf())
  } catch {
    cachedLogins = []
  }
}

document.addEventListener(
  'focusin',
  (e) => {
    if (!isTopFrame) return
    const el = e.target as HTMLElement
    if (
      el instanceof HTMLInputElement &&
      (el.type === 'password' || el.type === 'text' || el.type === 'email') &&
      cachedLogins.length > 0
    ) {
      showDropdown(el, cachedLogins)
    }
  },
  true
)
document.addEventListener('focusout', () => setTimeout(removeDropdown, 150), true)

if (isTopFrame) {
  window.addEventListener('DOMContentLoaded', refreshLogins)
  refreshLogins()
}
