import { ipcRenderer } from 'electron'

function originOf(): string {
  return location.origin
}

// Autofill runs only in the top-level document; subframes stay inert.
const isTopFrame = window.top === window

function findUsername(form: HTMLFormElement, pw: HTMLInputElement): string {
  const fields = Array.from(form.querySelectorAll('input')) as HTMLInputElement[]
  const pwIdx = fields.indexOf(pw)
  for (let i = pwIdx - 1; i >= 0; i--) {
    const t = (fields[i].type || '').toLowerCase()
    if (t === 'text' || t === 'email' || fields[i].autocomplete === 'username') return fields[i].value
  }
  const named = form.querySelector<HTMLInputElement>('input[autocomplete="username"], input[type="email"]')
  return named?.value ?? ''
}

if (isTopFrame) {
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target as HTMLElement
      if (!(form instanceof HTMLFormElement)) return
      const pw = form.querySelector<HTMLInputElement>('input[type="password"]')
      if (!pw || !pw.value) return
      const username = findUsername(form, pw)
      ipcRenderer.send('autofill:captured', { origin: originOf(), username, password: pw.value })
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
