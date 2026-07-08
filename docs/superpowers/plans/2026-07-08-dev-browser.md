# dev-browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal Windows browser (`.exe`) with project tab-groups, per-tab isolated persisted sessions (fresh session per `+`, duplicate shares session), and a floating minimal API/network panel per tab.

**Architecture:** Electron main process owns the window, one `WebContentsView` per tab (each with its own `persist:tab-<uuid>` session partition), a JSON state file, and CDP-based network capture. The chrome UI (group chips / tab strip / address bar) is a React app in the window's own renderer; the API panel is a second React page opened in small floating `BrowserWindow`s. Pure logic (state store, URL normalization, state file, request ring-buffer) is Electron-free and unit-tested with vitest; Electron integration is verified manually per task.

**Tech Stack:** Electron (WebContentsView, session partitions, webContents.debugger/CDP), electron-vite, React 19, TypeScript, vitest, electron-builder (NSIS Windows exe).

**Spec:** `docs/superpowers/specs/2026-07-08-dev-browser-design.md`

**Working dir:** all commands run from the repo root `dev-browser/`. This is a brand-new repo; work happens on `master`.

---

## File Structure

```
dev-browser/
  package.json
  .gitignore
  tsconfig.json
  electron.vite.config.ts
  electron-builder.yml                  (Task 12)
  src/
    shared/
      types.ts                          data shapes shared by all processes
      normalizeUrl.ts                   address-bar input -> URL (pure)
    main/
      index.ts                          app assembly: window, IPC, shortcuts, wiring
      state.ts                          AppStore: groups/tabs/sessions bookkeeping (pure, tested)
      stateFile.ts                      load/save/debounce JSON state (pure, tested)
      tabs.ts                           TabManager: WebContentsView lifecycle + error page
      requestLog.ts                     RequestLog: capped request ring-buffer (pure, tested)
      capture.ts                        NetworkCapture: CDP attach + Network.* events
      apiPanel.ts                       PanelManager: floating panel windows per tab
    preload/
      index.ts                          contextBridge typed API (window.devb)
    renderer/
      index.html                        chrome UI page
      panel.html                        API panel page
      src/
        env.d.ts                        window.devb typing
        chrome/  main.tsx App.tsx GroupBar.tsx TabBar.tsx AddressBar.tsx
                 ContextMenu.tsx EditableLabel.tsx styles.css
        panel/   main.tsx Panel.tsx styles.css
  tests/
    normalizeUrl.test.ts
    state.test.ts
    stateFile.test.ts
    requestLog.test.ts
  docs/superpowers/smoke-checklist.md   (Task 13)
```

Key boundaries:
- `src/shared/*`, `src/main/state.ts`, `src/main/stateFile.ts`, `src/main/requestLog.ts` import **nothing from Electron** → unit-testable in plain node.
- `AppStore` is the single source of truth. It never touches Electron; `main/index.ts` reacts to its `onChange` (sync shown view → push state to renderer → schedule save).
- Renderer never gets Node access (`contextIsolation` default on); it only calls the typed `window.devb` API.

---

### Task 1: Project scaffold (empty window runs)

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts` (minimal — replaced in Task 11)
- Create: `src/preload/index.ts` (minimal — replaced in Task 8)
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/chrome/main.tsx` (minimal — replaced in Task 9)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "dev-browser",
  "version": "0.1.0",
  "description": "Personal developer browser with per-tab isolated sessions",
  "main": "./out/main/index.js",
  "author": "jacks",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "dist": "electron-vite build && electron-builder --win"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
out/
release/
*.log
```

- [ ] **Step 3: Install dependencies (latest versions)**

Run:
```bash
npm i -D electron electron-vite electron-builder vite @vitejs/plugin-react typescript vitest react react-dom @types/react @types/react-dom @types/node
```
Expected: completes without errors; `package.json` gains `devDependencies`. (Everything is bundled by electron-vite, so devDependencies is correct — it also keeps the packaged exe small.)

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Write `electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          chrome: resolve(__dirname, 'src/renderer/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html')
        }
      }
    }
  }
})
```

Note: `panel.html` doesn't exist until Task 10. Create it in this task as an empty placeholder so the config builds:

Create `src/renderer/panel.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>API Panel</title></head>
  <body><div id="root"></div></body>
</html>
```

- [ ] **Step 6: Write minimal `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 7: Write minimal `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('devb', { ping: () => 'pong' })
```

- [ ] **Step 8: Write `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>DevBrowser</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/chrome/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Write minimal `src/renderer/src/chrome/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>DevBrowser scaffold</h1>)
```

- [ ] **Step 10: Verify it runs**

Run: `npm run dev`
Expected: an Electron window opens showing "DevBrowser scaffold". Close the window (app exits).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: electron-vite + react scaffold"
```

---

### Task 2: Shared types + normalizeUrl (TDD)

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/normalizeUrl.ts`
- Test: `tests/normalizeUrl.test.ts`

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export interface TabInfo {
  id: string
  name: string
  customName: boolean // true once the user renames; page titles stop overriding
  url: string
  partition: string // 'persist:tab-<uuid>' — Electron session partition
}

export interface GroupInfo {
  id: string
  name: string
  tabs: TabInfo[]
}

export interface AppState {
  groups: GroupInfo[]
  activeGroupId: string
  activeTabByGroup: Record<string, string>
}

export interface RequestSummary {
  id: string
  method: string
  url: string
  resourceType: string // CDP type: 'Fetch' | 'XHR' | 'Document' | ...
  status: number | null // null until a response arrives
  durationMs: number | null // null until loading finishes
  failed?: string // CDP errorText when the request failed
}
```

- [ ] **Step 2: Write the failing tests — `tests/normalizeUrl.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/normalizeUrl.test.ts`
Expected: FAIL — cannot resolve `../src/shared/normalizeUrl`.

- [ ] **Step 4: Write `src/shared/normalizeUrl.ts`**

```ts
/** Turns address-bar input into a loadable URL. Bare ports go to localhost. */
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (/^(about|data|file):/i.test(s)) return s
  const port = s.match(/^:?(\d{2,5})(\/.*)?$/)
  if (port) return `http://localhost:${port[1]}${port[2] ?? ''}`
  return `http://${s}`
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/normalizeUrl.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared tests/normalizeUrl.test.ts
git commit -m "feat: shared types and address-bar url normalization"
```

---

### Task 3: AppStore — groups/tabs/sessions bookkeeping (TDD)

**Files:**
- Create: `src/main/state.ts`
- Test: `tests/state.test.ts`

This is the heart of the session model: `+` tab ⇒ fresh partition, duplicate ⇒ same partition, close ⇒ report whether the partition became orphaned. Pure TypeScript, no Electron imports.

- [ ] **Step 1: Write the failing tests — `tests/state.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { AppStore, createInitialState } from '../src/main/state'

describe('AppStore', () => {
  let store: AppStore
  beforeEach(() => {
    store = new AppStore()
  })

  it('starts with one empty group, active', () => {
    expect(store.state.groups).toHaveLength(1)
    expect(store.state.activeGroupId).toBe(store.state.groups[0].id)
    expect(store.state.groups[0].tabs).toHaveLength(0)
  })

  it('addGroup creates and activates a new group', () => {
    const g = store.addGroup()
    expect(store.state.groups).toHaveLength(2)
    expect(store.state.activeGroupId).toBe(g.id)
    expect(g.name).toBe('Group 2')
  })

  it('renameGroup / renameTab work; renamed tab keeps its name over page titles', () => {
    const g = store.state.groups[0]
    store.renameGroup(g.id, 'Project A')
    expect(store.group(g.id).name).toBe('Project A')

    const t = store.addTab(g.id)
    store.setTabTitle(t.id, 'Some Page')
    expect(store.findTab(t.id).tab.name).toBe('Some Page')
    store.renameTab(t.id, 'admin')
    store.setTabTitle(t.id, 'Other Page')
    expect(store.findTab(t.id).tab.name).toBe('admin')
  })

  it('every new tab gets a distinct persist: partition and becomes active', () => {
    const g = store.state.groups[0]
    const t1 = store.addTab(g.id)
    const t2 = store.addTab(g.id)
    expect(t1.partition).toMatch(/^persist:tab-/)
    expect(t2.partition).toMatch(/^persist:tab-/)
    expect(t1.partition).not.toBe(t2.partition)
    expect(store.state.activeTabByGroup[g.id]).toBe(t2.id)
  })

  it('duplicateTab shares the partition and copies the url', () => {
    const g = store.state.groups[0]
    const t1 = store.addTab(g.id, { url: 'http://localhost:3000' })
    const t2 = store.duplicateTab(t1.id)
    expect(t2.partition).toBe(t1.partition)
    expect(t2.url).toBe('http://localhost:3000')
    expect(t2.id).not.toBe(t1.id)
  })

  it('closeTab reports partition orphaned only when no other tab shares it', () => {
    const g = store.state.groups[0]
    const t1 = store.addTab(g.id)
    const t2 = store.duplicateTab(t1.id)
    expect(store.closeTab(t1.id).partitionOrphaned).toBe(false)
    expect(store.closeTab(t2.id).partitionOrphaned).toBe(true)
  })

  it('closing the active tab activates a neighbor', () => {
    const g = store.state.groups[0]
    const t1 = store.addTab(g.id)
    const t2 = store.addTab(g.id)
    const t3 = store.addTab(g.id)
    store.setActiveTab(t2.id)
    store.closeTab(t2.id)
    expect(store.state.activeTabByGroup[g.id]).toBe(t3.id)
    store.closeTab(t3.id)
    expect(store.state.activeTabByGroup[g.id]).toBe(t1.id)
    store.closeTab(t1.id)
    expect(store.state.activeTabByGroup[g.id]).toBeUndefined()
    expect(store.activeTab()).toBeNull()
  })

  it('deleteGroup returns its tabs and always keeps at least one group', () => {
    const g = store.state.groups[0]
    store.addTab(g.id)
    const removed = store.deleteGroup(g.id)
    expect(removed).toHaveLength(1)
    expect(store.state.groups).toHaveLength(1)
    expect(store.state.groups[0].tabs).toHaveLength(0)
    expect(store.state.activeGroupId).toBe(store.state.groups[0].id)
  })

  it('fires onChange on mutations', () => {
    let calls = 0
    store.onChange = () => calls++
    const g = store.addGroup()
    store.addTab(g.id)
    expect(calls).toBe(2)
  })

  it('createInitialState is a valid empty state', () => {
    const s = createInitialState()
    expect(s.groups[0].name).toBe('Group 1')
    expect(s.activeTabByGroup).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — cannot resolve `../src/main/state`.

- [ ] **Step 3: Write `src/main/state.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { AppState, GroupInfo, TabInfo } from '../shared/types'

export function newPartition(): string {
  return `persist:tab-${randomUUID()}`
}

export function createInitialState(): AppState {
  const g: GroupInfo = { id: randomUUID(), name: 'Group 1', tabs: [] }
  return { groups: [g], activeGroupId: g.id, activeTabByGroup: {} }
}

/** Single source of truth for groups/tabs/sessions. Pure data — no Electron. */
export class AppStore {
  onChange: () => void = () => {}

  constructor(public state: AppState = createInitialState()) {}

  private emit() {
    this.onChange()
  }

  group(groupId: string): GroupInfo {
    const g = this.state.groups.find((x) => x.id === groupId)
    if (!g) throw new Error(`no group ${groupId}`)
    return g
  }

  findTab(tabId: string): { group: GroupInfo; tab: TabInfo } {
    for (const group of this.state.groups) {
      const tab = group.tabs.find((t) => t.id === tabId)
      if (tab) return { group, tab }
    }
    throw new Error(`no tab ${tabId}`)
  }

  activeTab(): TabInfo | null {
    const id = this.state.activeTabByGroup[this.state.activeGroupId]
    if (!id) return null
    try {
      return this.findTab(id).tab
    } catch {
      return null
    }
  }

  addGroup(name?: string): GroupInfo {
    const g: GroupInfo = {
      id: randomUUID(),
      name: name ?? `Group ${this.state.groups.length + 1}`,
      tabs: []
    }
    this.state.groups.push(g)
    this.state.activeGroupId = g.id
    this.emit()
    return g
  }

  renameGroup(groupId: string, name: string) {
    this.group(groupId).name = name
    this.emit()
  }

  /** Removes the group; returns its tabs so the caller can destroy views/sessions. */
  deleteGroup(groupId: string): TabInfo[] {
    const g = this.group(groupId)
    this.state.groups = this.state.groups.filter((x) => x.id !== groupId)
    if (this.state.groups.length === 0) {
      this.state.groups.push({ id: randomUUID(), name: 'Group 1', tabs: [] })
    }
    if (this.state.activeGroupId === groupId) this.state.activeGroupId = this.state.groups[0].id
    delete this.state.activeTabByGroup[groupId]
    this.emit()
    return g.tabs
  }

  addTab(groupId: string, opts: { url?: string; partition?: string } = {}): TabInfo {
    const group = this.group(groupId)
    const tab: TabInfo = {
      id: randomUUID(),
      name: 'New Tab',
      customName: false,
      url: opts.url ?? 'about:blank',
      partition: opts.partition ?? newPartition()
    }
    group.tabs.push(tab)
    this.state.activeGroupId = groupId
    this.state.activeTabByGroup[groupId] = tab.id
    this.emit()
    return tab
  }

  duplicateTab(tabId: string): TabInfo {
    const { group, tab } = this.findTab(tabId)
    return this.addTab(group.id, { url: tab.url, partition: tab.partition })
  }

  /** partitionOrphaned=true when no remaining tab shares the closed tab's session. */
  closeTab(tabId: string): { tab: TabInfo; partitionOrphaned: boolean } {
    const { group, tab } = this.findTab(tabId)
    const idx = group.tabs.indexOf(tab)
    group.tabs.splice(idx, 1)
    if (this.state.activeTabByGroup[group.id] === tabId) {
      const next = group.tabs[Math.min(idx, group.tabs.length - 1)]
      if (next) this.state.activeTabByGroup[group.id] = next.id
      else delete this.state.activeTabByGroup[group.id]
    }
    this.emit()
    return { tab, partitionOrphaned: !this.isPartitionInUse(tab.partition) }
  }

  renameTab(tabId: string, name: string) {
    const { tab } = this.findTab(tabId)
    tab.name = name
    tab.customName = true
    this.emit()
  }

  setTabUrl(tabId: string, url: string) {
    this.findTab(tabId).tab.url = url
    this.emit()
  }

  setTabTitle(tabId: string, title: string) {
    const { tab } = this.findTab(tabId)
    if (!tab.customName && title) {
      tab.name = title
      this.emit()
    }
  }

  setActiveGroup(groupId: string) {
    this.group(groupId)
    this.state.activeGroupId = groupId
    this.emit()
  }

  setActiveTab(tabId: string) {
    const { group } = this.findTab(tabId)
    this.state.activeGroupId = group.id
    this.state.activeTabByGroup[group.id] = tabId
    this.emit()
  }

  isPartitionInUse(partition: string): boolean {
    return this.state.groups.some((g) => g.tabs.some((t) => t.partition === partition))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/state.ts tests/state.test.ts
git commit -m "feat: AppStore with per-tab session partitions and duplicate-shares-session"
```

---

### Task 4: State file persistence (TDD)

**Files:**
- Create: `src/main/stateFile.ts`
- Test: `tests/stateFile.test.ts`

The file path is passed in (not read from Electron) so this stays unit-testable. Writes go to a temp file then rename, so a crash mid-write can't corrupt the state.

- [ ] **Step 1: Write the failing tests — `tests/stateFile.test.ts`**

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInitialState } from '../src/main/state'
import { loadState, saveState } from '../src/main/stateFile'

describe('stateFile', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'devb-'))
    file = join(dir, 'state.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips state', () => {
    const state = createInitialState()
    state.groups[0].name = 'Project A'
    saveState(file, state)
    expect(loadState(file)).toEqual(state)
  })

  it('returns null for a missing file', () => {
    expect(loadState(file)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    writeFileSync(file, '{not json')
    expect(loadState(file)).toBeNull()
  })

  it('returns null for JSON with the wrong shape', () => {
    writeFileSync(file, JSON.stringify({ groups: 5 }))
    expect(loadState(file)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stateFile.test.ts`
Expected: FAIL — cannot resolve `../src/main/stateFile`.

- [ ] **Step 3: Write `src/main/stateFile.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState } from '../shared/types'

/** Returns null on missing/corrupt/misshapen file — caller starts fresh, never crashes. */
export function loadState(file: string): AppState | null {
  try {
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (
      !Array.isArray(data.groups) ||
      typeof data.activeGroupId !== 'string' ||
      typeof data.activeTabByGroup !== 'object' ||
      data.activeTabByGroup === null
    ) {
      return null
    }
    return data as AppState
  } catch {
    return null
  }
}

export function saveState(file: string, state: AppState) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

/** Debounced save; failures log and the next change retries. */
export function debouncedSaver(file: string, getState: () => AppState, delayMs = 300) {
  let timer: NodeJS.Timeout | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      try {
        saveState(file, getState())
      } catch (err) {
        console.error('state save failed', err)
      }
    }, delayMs)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stateFile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS (normalizeUrl + state + stateFile).

```bash
git add src/main/stateFile.ts tests/stateFile.test.ts
git commit -m "feat: atomic json state persistence with corrupt-file fallback"
```

---

### Task 5: RequestLog — capped network request buffer (TDD)

**Files:**
- Create: `src/main/requestLog.ts`
- Test: `tests/requestLog.test.ts`

Pure buffer for CDP network events, capped at 500 per tab (oldest evicted). `summaries()` strips heavy fields for the list view; `get()` returns full detail for the clicked row.

- [ ] **Step 1: Write the failing tests — `tests/requestLog.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/requestLog.test.ts`
Expected: FAIL — cannot resolve `../src/main/requestLog`.

- [ ] **Step 3: Write `src/main/requestLog.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/requestLog.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/requestLog.ts tests/requestLog.test.ts
git commit -m "feat: capped request log for network capture"
```

---

### Task 6: TabManager — WebContentsView lifecycle

**Files:**
- Create: `src/main/tabs.ts`

One `WebContentsView` per open tab, created lazily on first show, with the tab's session partition. Only the active tab's view is attached to the window. Load failures swap in an inline `data:` error page (the spec's "in-view error message"); `data:` URLs are never written back to `tab.url`, so retry can reload the real URL. No unit tests (all Electron); verified in Task 11.

- [ ] **Step 1: Write `src/main/tabs.ts`**

```ts
import { BrowserWindow, WebContentsView, session } from 'electron'
import type { WebContents } from 'electron'
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
}

export class TabManager {
  private views = new Map<string, WebContentsView>()
  private shownTabId: string | null = null

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

  private openTab(tab: TabInfo): WebContentsView {
    const view = new WebContentsView({ webPreferences: { partition: tab.partition } })
    this.views.set(tab.id, view)
    const wc = view.webContents
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
    this.events.wireShortcuts(wc)
    if (tab.url && tab.url !== 'about:blank') wc.loadURL(tab.url)
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
    if (view) {
      if (this.shownTabId === tabId) {
        this.win.contentView.removeChildView(view)
        this.shownTabId = null
      }
      view.webContents.close()
      this.views.delete(tabId)
    }
    if (clearSession) {
      session
        .fromPartition(partition)
        .clearStorageData()
        .catch(() => {})
    }
  }

  navigate(tabId: string, url: string) {
    this.store.setTabUrl(tabId, url)
    const view = this.views.get(tabId)
    if (view) view.webContents.loadURL(url)
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
    view.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/tabs.ts
git commit -m "feat: TabManager with partitioned WebContentsViews and inline error page"
```

---

### Task 7: NetworkCapture + PanelManager

**Files:**
- Create: `src/main/capture.ts`
- Create: `src/main/apiPanel.ts`

`NetworkCapture` attaches the CDP debugger to a tab's webContents and feeds `RequestLog`. `PanelManager` owns one floating `BrowserWindow` + capture per tab, throttling updates to the panel at 100ms. Only one CDP client can attach at a time: `attach()` returns `false` if real DevTools is open (panel shows "capture unavailable"), and opening real DevTools detaches capture first.

- [ ] **Step 1: Write `src/main/capture.ts`**

```ts
import type { WebContents } from 'electron'
import { RequestLog } from './requestLog'

/** CDP-based network capture for one tab. Bodies fetched lazily via responseBody(). */
export class NetworkCapture {
  log = new RequestLog()
  attached = false
  onUpdate: () => void = () => {}

  constructor(private wc: WebContents) {}

  /** Returns false when another debugger (e.g. real DevTools) is attached. */
  attach(): boolean {
    if (this.attached) return true
    try {
      this.wc.debugger.attach('1.3')
    } catch {
      return false
    }
    this.attached = true
    this.wc.debugger.on('detach', () => {
      this.attached = false
    })
    this.wc.debugger.on('message', (_e, method, params) => this.onMessage(method, params))
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
    this.attached = false
  }

  private onMessage(method: string, p: any) {
    if (method === 'Network.requestWillBeSent') {
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
```

- [ ] **Step 2: Write `src/main/apiPanel.ts`**

```ts
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import { NetworkCapture } from './capture'

interface PanelEntry {
  win: BrowserWindow
  capture: NetworkCapture
}

/** One floating API-panel window + network capture per tab. */
export class PanelManager {
  private panels = new Map<string, PanelEntry>()

  constructor(private getTabWebContents: (tabId: string) => WebContents | undefined) {}

  get(tabId: string): PanelEntry | undefined {
    return this.panels.get(tabId)
  }

  /** Open the panel for a tab, or close it if already open. */
  toggle(tabId: string, tabName: string) {
    const existing = this.panels.get(tabId)
    if (existing) {
      existing.win.close() // 'closed' handler cleans up
      return
    }
    const wc = this.getTabWebContents(tabId)
    if (!wc) return

    const capture = new NetworkCapture(wc)
    const capturing = capture.attach()

    const win = new BrowserWindow({
      width: 760,
      height: 520,
      title: `API — ${tabName}`,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    const query = { tabId, capturing: String(capturing) }
    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html?tabId=${tabId}&capturing=${capturing}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/panel.html'), { query })
    }

    let timer: NodeJS.Timeout | null = null
    capture.onUpdate = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (!win.isDestroyed()) win.webContents.send('panel:requests', capture.log.summaries())
      }, 100)
    }

    win.on('closed', () => {
      capture.detach()
      this.panels.delete(tabId)
    })
    this.panels.set(tabId, { win, capture })
  }

  closeForTab(tabId: string) {
    this.panels.get(tabId)?.win.close()
  }

  /** Real DevTools needs the CDP slot — pause our capture for this tab. */
  detachForDevtools(tabId: string) {
    this.panels.get(tabId)?.capture.detach()
  }
}
```

- [ ] **Step 3: Type-check and run tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/capture.ts src/main/apiPanel.ts
git commit -m "feat: CDP network capture and floating panel window manager"
```

---

### Task 8: Preload — typed `window.devb` API

**Files:**
- Modify: `src/preload/index.ts` (replace entirely)
- Create: `src/renderer/src/env.d.ts`

- [ ] **Step 1: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppState, RequestSummary } from '../shared/types'

const api = {
  // --- chrome window: state ---
  getState: (): Promise<AppState> => ipcRenderer.invoke('app:getState'),
  onState: (cb: (state: AppState) => void) => {
    const h = (_e: IpcRendererEvent, s: AppState) => cb(s)
    ipcRenderer.on('state:changed', h)
    return () => ipcRenderer.removeListener('state:changed', h)
  },
  onFocusAddress: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('chrome:focusAddress', h)
    return () => ipcRenderer.removeListener('chrome:focusAddress', h)
  },

  // --- groups ---
  addGroup: (): Promise<void> => ipcRenderer.invoke('group:add'),
  renameGroup: (id: string, name: string): Promise<void> => ipcRenderer.invoke('group:rename', id, name),
  deleteGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:delete', id),
  activateGroup: (id: string): Promise<void> => ipcRenderer.invoke('group:activate', id),

  // --- tabs ---
  addTab: (groupId: string): Promise<void> => ipcRenderer.invoke('tab:add', groupId),
  duplicateTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:duplicate', id),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:close', id),
  renameTab: (id: string, name: string): Promise<void> => ipcRenderer.invoke('tab:rename', id, name),
  activateTab: (id: string): Promise<void> => ipcRenderer.invoke('tab:activate', id),
  navigate: (id: string, input: string): Promise<void> => ipcRenderer.invoke('tab:navigate', id, input),
  back: (id: string): Promise<void> => ipcRenderer.invoke('tab:back', id),
  forward: (id: string): Promise<void> => ipcRenderer.invoke('tab:forward', id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke('tab:reload', id),
  togglePanel: (id: string): Promise<void> => ipcRenderer.invoke('panel:toggle', id),

  // --- API panel window ---
  panelInit: (tabId: string): Promise<{ requests: RequestSummary[]; capturing: boolean }> =>
    ipcRenderer.invoke('panel:init', tabId),
  onRequests: (cb: (requests: RequestSummary[]) => void) => {
    const h = (_e: IpcRendererEvent, r: RequestSummary[]) => cb(r)
    ipcRenderer.on('panel:requests', h)
    return () => ipcRenderer.removeListener('panel:requests', h)
  },
  getRequestDetail: (tabId: string, requestId: string): Promise<unknown> =>
    ipcRenderer.invoke('panel:detail', tabId, requestId),
  getResponseBody: (tabId: string, requestId: string): Promise<string | null> =>
    ipcRenderer.invoke('panel:body', tabId, requestId),
  clearRequests: (tabId: string): Promise<void> => ipcRenderer.invoke('panel:clear', tabId)
}

export type DevBrowserApi = typeof api

contextBridge.exposeInMainWorld('devb', api)
```

- [ ] **Step 2: Write `src/renderer/src/env.d.ts`**

```ts
import type { DevBrowserApi } from '../../preload/index'

declare global {
  interface Window {
    devb: DevBrowserApi
  }
}

export {}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: typed preload api (window.devb)"
```

---

### Task 9: Chrome UI — groups, tabs, address bar (React)

**Files:**
- Modify: `src/renderer/src/chrome/main.tsx` (replace entirely)
- Create: `src/renderer/src/chrome/App.tsx`
- Create: `src/renderer/src/chrome/GroupBar.tsx`
- Create: `src/renderer/src/chrome/TabBar.tsx`
- Create: `src/renderer/src/chrome/AddressBar.tsx`
- Create: `src/renderer/src/chrome/ContextMenu.tsx`
- Create: `src/renderer/src/chrome/EditableLabel.tsx`
- Create: `src/renderer/src/chrome/styles.css`

Interactions per spec: click chip = activate; double-click = inline rename; right-click group = Rename/Delete (delete confirms); right-click tab = Duplicate (same session)/Rename/Close; `+` on each row. The three rows total exactly `CHROME_HEIGHT` (96px) — the web page view sits below them.

- [ ] **Step 1: Write `src/renderer/src/chrome/EditableLabel.tsx`**

```tsx
import { useState } from 'react'

export function EditableLabel({
  value,
  onDone
}: {
  value: string
  onDone: (newValue: string | null) => void
}) {
  const [v, setV] = useState(value)
  return (
    <input
      className="edit"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
      onBlur={() => onDone(v.trim() || null)}
    />
  )
}
```

- [ ] **Step 2: Write `src/renderer/src/chrome/ContextMenu.tsx`**

```tsx
import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  useEffect(() => {
    window.addEventListener('click', onClose)
    window.addEventListener('contextmenu', onClose)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('contextmenu', onClose)
    }
  }, [onClose])
  return (
    <div className="ctx" style={{ left: x, top: y }}>
      {items.map((it) => (
        <div
          key={it.label}
          className="ctx-item"
          onClick={(e) => {
            e.stopPropagation()
            it.onClick()
            onClose()
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/chrome/GroupBar.tsx`**

```tsx
import { useState } from 'react'
import type { GroupInfo } from '../../../shared/types'
import { ContextMenu } from './ContextMenu'
import { EditableLabel } from './EditableLabel'

function GroupChip({ group, active }: { group: GroupInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <div
        className={'chip' + (active ? ' active' : '')}
        onClick={() => window.devb.activateGroup(group.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {editing ? (
          <EditableLabel
            value={group.name}
            onDone={(v) => {
              if (v) window.devb.renameGroup(group.id, v)
              setEditing(false)
            }}
          />
        ) : (
          <span className="label">{group.name}</span>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', onClick: () => setEditing(true) },
            {
              label: 'Delete',
              onClick: () => {
                if (confirm(`Delete group "${group.name}" and all its tabs?`)) {
                  window.devb.deleteGroup(group.id)
                }
              }
            }
          ]}
        />
      )}
    </>
  )
}

export function GroupBar({ groups, activeId }: { groups: GroupInfo[]; activeId: string }) {
  return (
    <div className="row groups">
      {groups.map((g) => (
        <GroupChip key={g.id} group={g} active={g.id === activeId} />
      ))}
      <button className="add" title="New group" onClick={() => window.devb.addGroup()}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Write `src/renderer/src/chrome/TabBar.tsx`**

```tsx
import { useState } from 'react'
import type { GroupInfo, TabInfo } from '../../../shared/types'
import { ContextMenu } from './ContextMenu'
import { EditableLabel } from './EditableLabel'

function TabChip({ tab, active }: { tab: TabInfo; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <div
        className={'chip' + (active ? ' active' : '')}
        onClick={() => window.devb.activateTab(tab.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {editing ? (
          <EditableLabel
            value={tab.name}
            onDone={(v) => {
              if (v) window.devb.renameTab(tab.id, v)
              setEditing(false)
            }}
          />
        ) : (
          <span className="label">{tab.name}</span>
        )}
        <span
          className="close"
          title="Close tab"
          onClick={(e) => {
            e.stopPropagation()
            window.devb.closeTab(tab.id)
          }}
        >
          ×
        </span>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Duplicate (same session)', onClick: () => window.devb.duplicateTab(tab.id) },
            { label: 'Rename', onClick: () => setEditing(true) },
            { label: 'Close', onClick: () => window.devb.closeTab(tab.id) }
          ]}
        />
      )}
    </>
  )
}

export function TabBar({ group, activeTabId }: { group: GroupInfo; activeTabId: string | null }) {
  return (
    <div className="row tabs">
      {group.tabs.map((t) => (
        <TabChip key={t.id} tab={t} active={t.id === activeTabId} />
      ))}
      <button className="add" title="New tab (fresh session)" onClick={() => window.devb.addTab(group.id)}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/chrome/AddressBar.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '../../../shared/types'

export function AddressBar({ tab }: { tab: TabInfo | null }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  // Reflect the tab's URL unless the user is typing.
  useEffect(() => {
    if (!focused) setValue(!tab || tab.url === 'about:blank' ? '' : tab.url)
  }, [tab?.id, tab?.url, focused])

  useEffect(
    () =>
      window.devb.onFocusAddress(() => {
        ref.current?.focus()
        ref.current?.select()
      }),
    []
  )

  return (
    <div className="row addr">
      <button disabled={!tab} title="Back" onClick={() => tab && window.devb.back(tab.id)}>
        ◀
      </button>
      <button disabled={!tab} title="Forward" onClick={() => tab && window.devb.forward(tab.id)}>
        ▶
      </button>
      <button disabled={!tab} title="Reload (Ctrl+R)" onClick={() => tab && window.devb.reload(tab.id)}>
        ⟳
      </button>
      <input
        ref={ref}
        disabled={!tab}
        placeholder={tab ? 'URL, host, or :port — Enter to go (Ctrl+L)' : 'open a tab with +'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && tab && value.trim()) {
            window.devb.navigate(tab.id, value)
            ref.current?.blur()
          }
        }}
      />
      <button disabled={!tab} title="API panel (F12)" onClick={() => tab && window.devb.togglePanel(tab.id)}>
        API
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Write `src/renderer/src/chrome/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { AddressBar } from './AddressBar'
import { GroupBar } from './GroupBar'
import { TabBar } from './TabBar'

export function App() {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    window.devb.getState().then(setState)
    return window.devb.onState(setState)
  }, [])

  if (!state) return null
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  const activeTabId = state.activeTabByGroup[group.id] ?? null
  const activeTab = group.tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <>
      <GroupBar groups={state.groups} activeId={group.id} />
      <TabBar group={group} activeTabId={activeTabId} />
      <AddressBar tab={activeTab} />
    </>
  )
}
```

- [ ] **Step 7: Write `src/renderer/src/chrome/styles.css`**

```css
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font: 13px system-ui, sans-serif;
  background: #1b1e24;
  color: #d8dbe2;
  overflow: hidden;
  user-select: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 6px;
}
.groups {
  background: #14161b;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 6px;
  cursor: default;
  white-space: nowrap;
  max-width: 220px;
  color: #9aa0ab;
}
.chip .label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip:hover {
  background: #262b33;
}
.chip.active {
  background: #2e3440;
  color: #fff;
}
.close {
  opacity: 0.5;
  padding: 0 2px;
}
.close:hover {
  opacity: 1;
  color: #e06c75;
}
.add {
  background: none;
  border: none;
  color: #9aa0ab;
  font-size: 16px;
  cursor: pointer;
}
.add:hover {
  color: #fff;
}
.addr input {
  flex: 1;
  background: #14161b;
  border: 1px solid #2e3440;
  border-radius: 6px;
  color: #d8dbe2;
  padding: 5px 10px;
  outline: none;
}
.addr input:focus {
  border-color: #4a5162;
}
.addr button {
  background: #2e3440;
  border: none;
  border-radius: 6px;
  color: #d8dbe2;
  cursor: pointer;
  padding: 4px 10px;
}
.addr button:disabled {
  opacity: 0.4;
  cursor: default;
}
.edit {
  background: #14161b;
  border: 1px solid #4a5162;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  padding: 1px 4px;
  width: 110px;
}
.ctx {
  position: fixed;
  z-index: 10;
  background: #262b33;
  border: 1px solid #3a4150;
  border-radius: 6px;
  padding: 4px;
  min-width: 190px;
  box-shadow: 0 4px 16px #0008;
}
.ctx-item {
  padding: 6px 10px;
  border-radius: 4px;
  cursor: default;
}
.ctx-item:hover {
  background: #2e3440;
}
```

- [ ] **Step 8: Replace `src/renderer/src/chrome/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The UI can't be exercised yet — main-process IPC lands in Task 11.)

- [ ] **Step 10: Commit**

```bash
git add src/renderer
git commit -m "feat: chrome ui — group chips, tab strip, address bar"
```

---

### Task 10: API panel UI (React)

**Files:**
- Modify: `src/renderer/panel.html` (replace placeholder)
- Create: `src/renderer/src/panel/main.tsx`
- Create: `src/renderer/src/panel/Panel.tsx`
- Create: `src/renderer/src/panel/styles.css`

Request list (method, path, status, duration) + substring filter + fetch/XHR-only toggle + Clear; click a row for detail with request/response headers and pretty-printed JSON bodies (response body fetched lazily).

- [ ] **Step 1: Replace `src/renderer/panel.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>API Panel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/panel/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/renderer/src/panel/Panel.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RequestSummary } from '../../../shared/types'

interface StoredRequestView extends RequestSummary {
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string>
}

function pretty(s: string | null): string {
  if (s == null || s === '') return '—'
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function Headers({ headers }: { headers: Record<string, string> }) {
  const keys = Object.keys(headers)
  if (keys.length === 0) return <p className="dim">—</p>
  return (
    <table className="kv">
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{headers[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Detail({ tabId, requestId }: { tabId: string; requestId: string }) {
  const [detail, setDetail] = useState<StoredRequestView | null>(null)
  const [body, setBody] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setBody(null)
    window.devb.getRequestDetail(tabId, requestId).then((d) => setDetail(d as StoredRequestView | null))
    window.devb.getResponseBody(tabId, requestId).then(setBody)
  }, [tabId, requestId])

  if (!detail) return <div className="detail dim">loading…</div>
  return (
    <div className="detail">
      <h3>
        {detail.method} {detail.status ?? ''} {detail.failed ? `FAILED: ${detail.failed}` : ''}
      </h3>
      <p className="url">{detail.url}</p>
      <h4>Request headers</h4>
      <Headers headers={detail.requestHeaders} />
      <h4>Request body</h4>
      <pre>{pretty(detail.requestBody)}</pre>
      <h4>Response headers</h4>
      <Headers headers={detail.responseHeaders} />
      <h4>Response body</h4>
      <pre>{pretty(body)}</pre>
    </div>
  )
}

export function Panel({ tabId, initialCapturing }: { tabId: string; initialCapturing: boolean }) {
  const [requests, setRequests] = useState<RequestSummary[]>([])
  const [capturing, setCapturing] = useState(initialCapturing)
  const [filter, setFilter] = useState('')
  const [apiOnly, setApiOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.devb.panelInit(tabId).then((r) => {
      setRequests(r.requests)
      setCapturing(r.capturing)
    })
    return window.devb.onRequests(setRequests)
  }, [tabId])

  // Keep the list pinned to the newest entries.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [requests.length])

  const shown = requests.filter(
    (r) =>
      (!apiOnly || r.resourceType === 'Fetch' || r.resourceType === 'XHR') &&
      (!filter || r.url.includes(filter))
  )

  return (
    <div className="panel">
      <div className="toolbar">
        <input placeholder="filter url, e.g. /api/" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label>
          <input type="checkbox" checked={apiOnly} onChange={(e) => setApiOnly(e.target.checked)} /> fetch/XHR
          only
        </label>
        <button
          onClick={() => {
            window.devb.clearRequests(tabId)
            setSelected(null)
          }}
        >
          Clear
        </button>
        {!capturing && <span className="warn">capture unavailable (close DevTools and reopen panel)</span>}
      </div>
      <div className="split">
        <div className="list" ref={listRef}>
          <table>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className={(selected === r.id ? 'sel ' : '') + (r.failed ? 'failed' : '')}
                  onClick={() => setSelected(r.id)}
                >
                  <td className="method">{r.method}</td>
                  <td className="path" title={r.url}>
                    {shortUrl(r.url)}
                  </td>
                  <td className="status">{r.failed ? 'ERR' : (r.status ?? '…')}</td>
                  <td className="dur">{r.durationMs != null ? `${r.durationMs}ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="dim empty">no requests yet — interact with the page</p>}
        </div>
        {selected && <Detail tabId={tabId} requestId={selected} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/panel/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client'
import { Panel } from './Panel'
import './styles.css'

const params = new URLSearchParams(location.search)
const tabId = params.get('tabId') ?? ''
const capturing = params.get('capturing') !== 'false'

createRoot(document.getElementById('root')!).render(<Panel tabId={tabId} initialCapturing={capturing} />)
```

- [ ] **Step 4: Write `src/renderer/src/panel/styles.css`**

```css
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font: 12px ui-monospace, Consolas, monospace;
  background: #1b1e24;
  color: #d8dbe2;
}
.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  background: #14161b;
}
.toolbar input[type='text'],
.toolbar input:not([type]) {
  flex: 0 0 220px;
  background: #1b1e24;
  border: 1px solid #2e3440;
  border-radius: 4px;
  color: #d8dbe2;
  padding: 4px 8px;
  outline: none;
}
.toolbar button {
  background: #2e3440;
  border: none;
  border-radius: 4px;
  color: #d8dbe2;
  cursor: pointer;
  padding: 4px 10px;
}
.warn {
  color: #e5c07b;
}
.split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.list {
  flex: 1;
  overflow: auto;
  border-right: 1px solid #2e3440;
}
.list table {
  width: 100%;
  border-collapse: collapse;
}
.list tr {
  cursor: default;
}
.list tr:hover {
  background: #22262e;
}
.list tr.sel {
  background: #2e3440;
}
.list tr.failed td {
  color: #e06c75;
}
.list td {
  padding: 3px 8px;
  border-bottom: 1px solid #22262e;
  white-space: nowrap;
}
.method {
  color: #61afef;
  width: 1%;
}
.path {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status {
  width: 1%;
}
.dur {
  width: 1%;
  color: #9aa0ab;
}
.detail {
  flex: 1;
  overflow: auto;
  padding: 10px;
}
.detail h3 {
  margin: 0 0 4px;
}
.detail h4 {
  margin: 14px 0 4px;
  color: #9aa0ab;
}
.detail .url {
  word-break: break-all;
  color: #9aa0ab;
  margin: 0;
}
.detail pre {
  background: #14161b;
  padding: 8px;
  border-radius: 4px;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;
  word-break: break-all;
}
.kv td {
  vertical-align: top;
  padding: 1px 8px 1px 0;
  word-break: break-all;
}
.kv td:first-child {
  color: #61afef;
  white-space: nowrap;
}
.dim {
  color: #5c6370;
}
.empty {
  text-align: center;
  margin-top: 30px;
}
```

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/renderer
git commit -m "feat: api panel ui — request list, filter, json detail"
```

---

### Task 11: Main-process assembly — everything wired, first full run

**Files:**
- Modify: `src/main/index.ts` (replace entirely)

This connects AppStore ↔ TabManager ↔ PanelManager ↔ IPC ↔ persistence ↔ shortcuts. After this task the app is feature-complete in dev mode.

- [ ] **Step 1: Replace `src/main/index.ts`**

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeUrl } from '../shared/normalizeUrl'
import { PanelManager } from './apiPanel'
import { AppStore } from './state'
import { debouncedSaver, loadState, saveState } from './stateFile'
import { TabManager } from './tabs'

let win: BrowserWindow
let store: AppStore
let tabs: TabManager
let panels: PanelManager

const stateFile = () => join(app.getPath('userData'), 'state.json')

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', store.state)
}

function syncShownTab() {
  const tab = store.activeTab()
  if (tab) tabs.showTab(tab.id)
  else tabs.hideCurrent()
}

/** Startup safety net: delete partition dirs no tab references anymore. */
function cleanOrphanPartitions() {
  const dir = join(app.getPath('userData'), 'Partitions')
  if (!existsSync(dir)) return
  const valid = new Set<string>()
  for (const g of store.state.groups) {
    for (const t of g.tabs) valid.add(t.partition.replace(/^persist:/, ''))
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith('tab-') && !valid.has(name)) {
      try {
        rmSync(join(dir, name), { recursive: true, force: true })
      } catch {
        /* locked dir — retry next launch */
      }
    }
  }
}

function closeTab(tabId: string) {
  const { tab, partitionOrphaned } = store.closeTab(tabId)
  panels.closeForTab(tabId)
  tabs.closeTab(tabId, partitionOrphaned, tab.partition)
  syncShownTab()
}

function togglePanel(tabId: string) {
  const { tab } = store.findTab(tabId)
  panels.toggle(tabId, tab.name)
}

function openRealDevtools(tabId: string) {
  panels.detachForDevtools(tabId) // free the CDP slot
  tabs.view(tabId)?.webContents.openDevTools({ mode: 'detach' })
}

/** Ctrl+T / Ctrl+W / Ctrl+L / Ctrl+R / F12 / Ctrl+Shift+F12 — works with focus in page or chrome. */
function wireShortcuts(wc: WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = input.key.toLowerCase()
    const tab = store.activeTab()
    if (ctrl && !input.shift && key === 't') {
      event.preventDefault()
      store.addTab(store.state.activeGroupId)
    } else if (ctrl && key === 'w') {
      event.preventDefault()
      if (tab) closeTab(tab.id)
    } else if (ctrl && key === 'l') {
      event.preventDefault()
      win.webContents.focus()
      win.webContents.send('chrome:focusAddress')
    } else if (key === 'f12' && ctrl && input.shift) {
      event.preventDefault()
      if (tab) openRealDevtools(tab.id)
    } else if (key === 'f12' && !ctrl && !input.shift) {
      event.preventDefault()
      if (tab) togglePanel(tab.id)
    } else if (ctrl && key === 'r') {
      event.preventDefault()
      if (tab) tabs.reload(tab.id)
    }
  })
}

function registerIpc() {
  ipcMain.handle('app:getState', () => store.state)

  ipcMain.handle('group:add', () => {
    store.addGroup()
  })
  ipcMain.handle('group:rename', (_e, id: string, name: string) => {
    store.renameGroup(id, name)
  })
  ipcMain.handle('group:delete', (_e, id: string) => {
    const removed = store.deleteGroup(id)
    for (const t of removed) {
      panels.closeForTab(t.id)
      tabs.closeTab(t.id, !store.isPartitionInUse(t.partition), t.partition)
    }
    syncShownTab()
  })
  ipcMain.handle('group:activate', (_e, id: string) => {
    store.setActiveGroup(id)
  })

  ipcMain.handle('tab:add', (_e, groupId: string) => {
    store.addTab(groupId)
  })
  ipcMain.handle('tab:duplicate', (_e, id: string) => {
    store.duplicateTab(id)
  })
  ipcMain.handle('tab:close', (_e, id: string) => closeTab(id))
  ipcMain.handle('tab:rename', (_e, id: string, name: string) => {
    store.renameTab(id, name)
  })
  ipcMain.handle('tab:activate', (_e, id: string) => {
    store.setActiveTab(id)
  })
  ipcMain.handle('tab:navigate', (_e, id: string, input: string) => {
    tabs.navigate(id, normalizeUrl(input))
  })
  ipcMain.handle('tab:back', (_e, id: string) => {
    tabs.view(id)?.webContents.navigationHistory.goBack()
  })
  ipcMain.handle('tab:forward', (_e, id: string) => {
    tabs.view(id)?.webContents.navigationHistory.goForward()
  })
  ipcMain.handle('tab:reload', (_e, id: string) => tabs.reload(id))

  ipcMain.handle('panel:toggle', (_e, id: string) => togglePanel(id))
  ipcMain.handle('panel:init', (_e, tabId: string) => {
    const p = panels.get(tabId)
    return p
      ? { requests: p.capture.log.summaries(), capturing: p.capture.attached }
      : { requests: [], capturing: false }
  })
  ipcMain.handle('panel:detail', (_e, tabId: string, requestId: string) => {
    return panels.get(tabId)?.capture.log.get(requestId) ?? null
  })
  ipcMain.handle('panel:body', (_e, tabId: string, requestId: string) => {
    return panels.get(tabId)?.capture.responseBody(requestId) ?? null
  })
  ipcMain.handle('panel:clear', (_e, tabId: string) => {
    const p = panels.get(tabId)
    if (p) {
      p.capture.log.clear()
      p.win.webContents.send('panel:requests', [])
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.on('closed', () => app.quit())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  store = new AppStore(loadState(stateFile()) ?? undefined)
  cleanOrphanPartitions()
  const scheduleSave = debouncedSaver(stateFile(), () => store.state)

  createWindow()
  tabs = new TabManager(win, store, { wireShortcuts })
  panels = new PanelManager((tabId) => tabs.view(tabId)?.webContents)

  store.onChange = () => {
    syncShownTab()
    pushState()
    scheduleSave()
  }
  registerIpc()
  wireShortcuts(win.webContents)

  win.webContents.on('did-finish-load', () => {
    pushState()
    syncShownTab()
  })
})

app.on('before-quit', () => {
  if (store) {
    try {
      saveState(stateFile(), store.state)
    } catch {
      /* best effort — debounced save already ran */
    }
  }
})
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 2: Type-check and run tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Manual verification — core flows**

Run: `npm run dev`, then verify each:

1. **Groups/tabs basics:** "Group 1" chip exists. `+` on the tab row opens an empty tab. Type `example.com` in the address bar, Enter → page loads below the chrome. Tab name becomes the page title.
2. **Rename:** double-click the group chip → type "Project A" → Enter. Double-click the tab → rename to "test". Navigate somewhere else — the name stays "test".
3. **Session isolation:** open two `+` tabs, load `https://github.com` in both. Log into account A in tab 1. Tab 2 must still show the logged-out page (reload it to confirm). *(Any site with login works; use your own local app if you prefer.)*
4. **Duplicate shares session:** right-click tab 1 → "Duplicate (same session)". The new tab must already be logged in as account A.
5. **Second group:** `+` on the group row → new group appears and activates with an empty tab strip. Click back and forth — each group shows its own tabs, and the page area follows the active tab.
6. **Delete group:** right-click group → Delete → confirm dialog → group and its tabs disappear.
7. **Shortcuts:** Ctrl+T (new tab), Ctrl+W (close), Ctrl+L (focus address bar) — all work with focus inside the page too.
8. **Error page:** navigate a tab to `:9999` (nothing listening) → the in-view "Could not load" page appears; the address bar still shows `http://localhost:9999`. Start something on that port (or change URL) and reload works.
9. **Persistence:** close the app, `npm run dev` again → groups, names, tabs, URLs are restored AND the github tab is still logged in.
10. **API panel:** open a tab on any site with XHR (e.g. github.com), press F12 → floating panel opens. Click around the site → fetch/XHR requests stream in. Type in the filter box → list narrows. Click a request → headers + pretty-printed JSON response body appear. Clear works. F12 again closes the panel.
11. **DevTools escape hatch:** Ctrl+Shift+F12 → real DevTools opens (detached). If the API panel was open it shows stale data (capture paused) — expected per spec.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire store, tabs, panels, ipc, shortcuts, persistence"
```

---

### Task 12: Windows packaging (exe)

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: Write `electron-builder.yml`**

```yaml
appId: com.jacks.devbrowser
productName: DevBrowser
directories:
  output: release
files:
  - out/**
win:
  target: nsis
nsis:
  oneClick: true
  deleteAppDataOnUninstall: false
```

- [ ] **Step 2: Build the installer**

Run: `npm run dist`
Expected: completes without errors; `release/DevBrowser Setup 0.1.0.exe` exists. (First run downloads Electron binaries — can take a few minutes.)

- [ ] **Step 3: Install and smoke-test the packaged app**

Run the installer from `release/`. Launch DevBrowser from the Start menu and verify: window opens, tabs load pages, F12 panel works, restart keeps state. Note: the packaged app uses its own userData dir (`%APPDATA%/DevBrowser`), so it starts fresh — that's expected.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml
git commit -m "feat: electron-builder windows packaging"
```

---

### Task 13: Smoke checklist doc + final pass

**Files:**
- Create: `docs/superpowers/smoke-checklist.md`

- [ ] **Step 1: Write `docs/superpowers/smoke-checklist.md`**

```markdown
# DevBrowser smoke checklist

Run after any significant change (dev mode or packaged exe).

- [ ] Two `+` tabs on the same login page → log into different accounts → both stay logged in independently
- [ ] Right-click → Duplicate → new tab shares the login
- [ ] Close one duplicated tab → the other keeps its login; close both → session gone (new tab on that site is logged out)
- [ ] Restart the app → groups, tab names, URLs, and logins all restored
- [ ] Group rename / tab rename stick (page titles don't overwrite a custom name)
- [ ] Delete group asks for confirmation and closes its tabs
- [ ] Address bar: `:3000` → `http://localhost:3000`; `example.com` → loads
- [ ] Unreachable port shows the in-view error page; reload retries the real URL
- [ ] F12 opens the floating API panel; fetch/XHR calls appear; filter works
- [ ] Clicking a request shows request/response headers and pretty JSON response body
- [ ] Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R, Ctrl+Shift+F12 all work with focus in the page
```

- [ ] **Step 2: Run the whole checklist against the packaged exe**

Every box must actually pass. Fix anything that fails before proceeding.

- [ ] **Step 3: Run the full test suite one final time**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/smoke-checklist.md
git commit -m "docs: smoke checklist"
```

---

## Notes for the implementer

- **Electron API level:** this plan targets current Electron (`WebContentsView`, `win.contentView`, `webContents.navigationHistory`, `webContents.close()` — all present since Electron 30+). If `npm i electron` pulls something older, upgrade.
- **Why devDependencies for react:** electron-vite bundles main, preload, and renderer; nothing is required from `node_modules` at runtime, and electron-builder then packs only `out/**`.
- **One CDP client rule:** the API panel and real DevTools can't capture simultaneously. The code prefers DevTools when explicitly opened (Ctrl+Shift+F12) and reports `capturing: false` in the panel otherwise. Reopening the panel after closing DevTools re-attaches.
- **Partition dirs:** Electron stores `persist:tab-<uuid>` data under `<userData>/Partitions/tab-<uuid>`. Cleanup only ever deletes dirs starting with `tab-` that no tab references.
- **`data:` error page:** never written to `tab.url` (guarded in `did-navigate`), so persistence and retry always use the real URL.
