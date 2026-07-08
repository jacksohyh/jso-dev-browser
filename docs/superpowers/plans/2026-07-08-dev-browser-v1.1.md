# dev-browser v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six features to the completed dev-browser: session-color grouping with a contiguity invariant, forward tab/group hotkeys, a merged (frameless) title bar, global page zoom, an OS-encrypted password manager with autofill, and a settings window.

**Architecture:** Pure logic (store, colors, vault) stays Electron-free and unit-tested with vitest; Electron integration (title bar, zoom application, autofill injection, settings/password windows) is verified by type-check + build + manual pass. New main modules: `vault.ts`, `autofillBridge.ts`, `settingsWindow.ts`. New renderer entries: `autofill-preload`, `settings/*`. Order is chosen so each task builds green on the previous: store/logic → title bar → zoom → session colors → settings shell → password manager.

**Tech Stack:** Electron (safeStorage/DPAPI, titleBarOverlay, WebContentsView zoom, injected preload), React 19, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-dev-browser-v1.1-design.md`

**Working dir:** repo root `C:\Users\jacks\OneDrive\Dokumenty\GitHub\dev-browser` (Windows/PowerShell), on `master`. Baseline: v1 complete, 27 vitest tests passing.

---

## File Structure

```
NEW  src/main/vault.ts                 encrypted password CRUD (safeStorage injected)
NEW  src/main/autofillBridge.ts        IPC glue: autofill query/secret/capture → Vault + save prompt
NEW  src/main/settingsWindow.ts        single-instance settings BrowserWindow manager
NEW  src/renderer/autofill-preload.ts  injected content script (submit capture + dropdown overlay)
NEW  src/renderer/settings.html        settings renderer entry
NEW  src/renderer/src/settings/{main.tsx,Settings.tsx,styles.css}
NEW  src/renderer/src/chrome/sessionColors.ts   pure color assignment
NEW  src/renderer/src/chrome/SavePrompt.tsx     save-password bar
NEW  tests/sessionColors.test.ts
NEW  tests/vault.test.ts
EDIT src/shared/types.ts               + AppState.zoom; + PasswordEntry, SavedLogin types
EDIT src/main/state.ts                 duplicateTab insert-adjacent; nextTab/nextGroup; setZoom
EDIT src/main/stateFile.ts             loadState back-compat default for zoom
EDIT src/main/tabs.ts                  autofill preload on views; zoom apply + zoom-changed
EDIT src/main/index.ts                 title bar opts; hotkeys; applyZoom; wire vault/autofill/settings/cog
EDIT src/preload/index.ts              + settings/save-prompt/zoom channels
EDIT src/renderer/src/chrome/{App,GroupBar,TabBar,styles.css}   colors, cog, drag regions, save prompt
EDIT electron.vite.config.ts           + settings + autofill-preload build inputs
EDIT tests/state.test.ts               + nextTab/nextGroup/setZoom/duplicate-adjacent cases
EDIT tests/stateFile.test.ts           + zoom back-compat case
```

---

### Task 1: Store — duplicate-adjacent, nextTab/nextGroup, setZoom, zoom in state (TDD)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: Add `zoom` to AppState in `src/shared/types.ts`**

In the `AppState` interface, add the field:
```ts
export interface AppState {
  groups: GroupInfo[]
  activeGroupId: string
  activeTabByGroup: Record<string, string>
  zoom: number // webContents zoom level shared by all tabs; 0 = 100%
}
```

- [ ] **Step 2: Add failing tests to `tests/state.test.ts`**

Append inside the existing `describe('AppStore', ...)` block:
```ts
  it('createInitialState includes zoom 0', () => {
    expect(store.state.zoom).toBe(0)
  })

  it('setZoom clamps to [-3, 3] and emits', () => {
    let calls = 0
    store.onChange = () => calls++
    store.setZoom(2)
    expect(store.state.zoom).toBe(2)
    store.setZoom(99)
    expect(store.state.zoom).toBe(3)
    store.setZoom(-99)
    expect(store.state.zoom).toBe(-3)
    expect(calls).toBe(3)
  })

  it('duplicateTab inserts immediately after the source cluster, not at the end', () => {
    const g = store.state.groups[0]
    const a = store.addTab(g.id) // [a]
    const b = store.addTab(g.id) // [a, b]
    const aDup = store.duplicateTab(a.id) // expect [a, aDup, b]
    const ids = store.group(g.id).tabs.map((t) => t.id)
    expect(ids).toEqual([a.id, aDup.id, b.id])
    // duplicating a again lands after the existing a-cluster: [a, aDup, aDup2, b]
    const aDup2 = store.duplicateTab(a.id)
    expect(store.group(g.id).tabs.map((t) => t.id)).toEqual([a.id, aDup.id, aDup2.id, b.id])
  })

  it('nextTab cycles forward within the active group and wraps', () => {
    const g = store.state.groups[0]
    const t1 = store.addTab(g.id)
    const t2 = store.addTab(g.id)
    const t3 = store.addTab(g.id)
    store.setActiveTab(t1.id)
    store.nextTab()
    expect(store.state.activeTabByGroup[g.id]).toBe(t2.id)
    store.nextTab()
    expect(store.state.activeTabByGroup[g.id]).toBe(t3.id)
    store.nextTab()
    expect(store.state.activeTabByGroup[g.id]).toBe(t1.id) // wrap
  })

  it('nextTab is a no-op with 0 or 1 tabs', () => {
    const g = store.state.groups[0]
    store.nextTab() // 0 tabs
    expect(store.activeTab()).toBeNull()
    const only = store.addTab(g.id)
    store.nextTab()
    expect(store.state.activeTabByGroup[g.id]).toBe(only.id)
  })

  it('nextGroup activates the next group and wraps, selecting its active tab', () => {
    const g1 = store.state.groups[0]
    const g2 = store.addGroup()
    const t2 = store.addTab(g2.id) // active tab of g2
    store.setActiveGroup(g1.id)
    store.nextGroup()
    expect(store.state.activeGroupId).toBe(g2.id)
    expect(store.activeTab()?.id).toBe(t2.id)
    store.nextGroup() // wrap back to g1
    expect(store.state.activeGroupId).toBe(g1.id)
  })

  it('nextGroup is a no-op with a single group', () => {
    const g1 = store.state.groups[0]
    store.nextGroup()
    expect(store.state.activeGroupId).toBe(g1.id)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `zoom` missing / `setZoom`, `nextTab`, `nextGroup` not functions, and duplicate ordering `[a, b, aDup]` ≠ expected.

- [ ] **Step 4: Update `createInitialState` in `src/main/state.ts`**

```ts
export function createInitialState(): AppState {
  const g: GroupInfo = { id: randomUUID(), name: 'Group 1', tabs: [] }
  return { groups: [g], activeGroupId: g.id, activeTabByGroup: {}, zoom: 0 }
}
```

- [ ] **Step 5: Change `duplicateTab` to insert adjacent in `src/main/state.ts`**

Replace the existing `duplicateTab` method with:
```ts
  duplicateTab(tabId: string): TabInfo {
    const { group, tab } = this.findTab(tabId)
    const dup: TabInfo = {
      id: randomUUID(),
      name: tab.name,
      customName: tab.customName,
      url: tab.url,
      partition: tab.partition
    }
    // Insert right after the last tab in the source partition's contiguous cluster.
    let last = group.tabs.indexOf(tab)
    while (last + 1 < group.tabs.length && group.tabs[last + 1].partition === tab.partition) last++
    group.tabs.splice(last + 1, 0, dup)
    this.state.activeGroupId = group.id
    this.state.activeTabByGroup[group.id] = dup.id
    this.emit()
    return dup
  }
```
(Note: this preserves the previous behavior of activating the new tab and copying url/partition; it no longer routes through `addTab`, so it can control insert position. `customName`/`name` are copied so a renamed tab's duplicate keeps the name.)

- [ ] **Step 6: Add `setZoom`, `nextTab`, `nextGroup` to `src/main/state.ts`**

Add these methods to the `AppStore` class (e.g. after `setActiveTab`):
```ts
  setZoom(level: number) {
    this.state.zoom = Math.max(-3, Math.min(3, level))
    this.emit()
  }

  nextTab() {
    const groupId = this.state.activeGroupId
    const group = this.group(groupId)
    if (group.tabs.length < 2) return
    const currentId = this.state.activeTabByGroup[groupId]
    const idx = group.tabs.findIndex((t) => t.id === currentId)
    const next = group.tabs[(idx + 1) % group.tabs.length]
    this.state.activeTabByGroup[groupId] = next.id
    this.emit()
  }

  nextGroup() {
    if (this.state.groups.length < 2) return
    const idx = this.state.groups.findIndex((g) => g.id === this.state.activeGroupId)
    const next = this.state.groups[(idx + 1) % this.state.groups.length]
    this.state.activeGroupId = next.id
    this.emit()
  }
```
(`nextGroup` relies on `activeTab()` reading `activeTabByGroup[activeGroupId]`, which already returns the group's remembered tab or null — no extra work needed. `idx = -1` fallback: `(-1 + 1) % n = 0` selects the first, a safe default.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS (all prior + 7 new).

- [ ] **Step 8: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: FAIL — `stateFile.ts`/`index.ts` and `loadState` shape checks now need `zoom`. That is fixed in Task 2; to keep this commit green, ALSO do Task 2 Step 1 now if tsc complains about `createInitialState`/`AppState` usage. If tsc is clean, commit:
```bash
git add src/shared/types.ts src/main/state.ts tests/state.test.ts
git commit -m "feat: store duplicate-adjacent, nextTab/nextGroup, zoom in state"
```
(If tsc fails only inside `stateFile.ts` loadState because the return type now requires `zoom`, proceed to Task 2 which fixes it, then commit both together.)

---

### Task 2: State file — zoom back-compat (TDD)

**Files:**
- Modify: `src/main/stateFile.ts`
- Test: `tests/stateFile.test.ts`

- [ ] **Step 1: Add failing test to `tests/stateFile.test.ts`**

Append inside the `describe('stateFile', ...)` block:
```ts
  it('defaults missing zoom to 0 for back-compat', () => {
    const s = createInitialState()
    // simulate an old v1 file with no zoom field
    const { zoom, ...noZoom } = s as any
    writeFileSync(file, JSON.stringify(noZoom))
    const loaded = loadState(file)
    expect(loaded).not.toBeNull()
    expect(loaded!.zoom).toBe(0)
  })

  it('preserves a valid zoom value', () => {
    const s = createInitialState()
    s.zoom = 2
    saveState(file, s)
    expect(loadState(file)!.zoom).toBe(2)
  })
```

- [ ] **Step 2: Run tests to verify the back-compat one fails**

Run: `npx vitest run tests/stateFile.test.ts`
Expected: FAIL — `loaded.zoom` is `undefined` for the old-file case.

- [ ] **Step 3: Update `loadState` in `src/main/stateFile.ts`**

Inside `loadState`, after the existing shape-validation `if (...) return null` block and before `return data as AppState`, add:
```ts
    if (typeof data.zoom !== 'number') data.zoom = 0
```
So the tail of the function reads:
```ts
    if (typeof data.zoom !== 'number') data.zoom = 0
    return data as AppState
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stateFile.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc clean (Task 1 + 2 together satisfy the `zoom` type).

- [ ] **Step 6: Commit**

```bash
git add src/main/stateFile.ts tests/stateFile.test.ts
git commit -m "feat: loadState defaults missing zoom (v1 back-compat)"
```

---

### Task 3: Merged title bar (frameless + window controls overlay)

**Files:**
- Modify: `src/main/index.ts` (createWindow)
- Modify: `src/renderer/src/chrome/styles.css`
- Modify: `src/renderer/src/chrome/GroupBar.tsx`

- [ ] **Step 1: Add title bar options in `createWindow` (`src/main/index.ts`)**

Change the `new BrowserWindow({...})` in `createWindow` to include the hidden title bar + overlay:
```ts
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14161b', symbolColor: '#d8dbe2', height: 32 },
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
```

- [ ] **Step 2: Add drag regions + overlay padding in `src/renderer/src/chrome/styles.css`**

Change the `.groups` rule and add drag/no-drag rules:
```css
.groups {
  background: #14161b;
  /* reserve space for the native window-controls overlay on the right */
  padding-right: 140px;
  -webkit-app-region: drag;
}
.groups .chip,
.groups .add,
.groups .cog {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: Add the cog button placeholder to the group row (`GroupBar.tsx`)**

In `GroupBar`, add a settings cog button after the `+` button (its click is wired in Task 8; for now it calls a method that will exist then — declare it in preload in Task 7. To keep this task self-contained and building, wire it to a no-op-safe optional call):
```tsx
export function GroupBar({ groups, activeId }: { groups: GroupInfo[]; activeId: string }) {
  return (
    <div className="row groups">
      {groups.map((g) => (
        <GroupChip key={g.id} group={g} active={g.id === activeId} />
      ))}
      <button className="add" title="New group" onClick={() => window.devb.addGroup()}>
        +
      </button>
      <span className="spacer" />
      <button className="cog" title="Settings" onClick={() => window.devb.openSettings?.()}>
        ⚙
      </button>
    </div>
  )
}
```
Add to the CSS (in the same styles.css):
```css
.spacer {
  flex: 1;
}
.cog {
  background: none;
  border: none;
  color: #9aa0ab;
  font-size: 15px;
  cursor: pointer;
  padding: 0 6px;
}
.cog:hover {
  color: #fff;
}
```
`window.devb.openSettings?.()` uses optional chaining so this builds before the channel exists (added in Task 7). TypeScript: because `openSettings` isn't on the type yet, add it to the preload API type in Task 7; to keep tsc happy NOW, temporarily also add `openSettings?: () => Promise<void>` — but since Task 7 adds the real one, instead guard with a cast: change the onClick to `onClick={() => (window.devb as any).openSettings?.()}`. Use the `as any` cast form to avoid a type error before Task 7.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; renderer bundles.

- [ ] **Step 5: Manual check**

Run: `npm run dev`. Confirm: no OS title bar; native min/max/close appear top-right, themed dark; the window can be dragged by the group row; group chips, `+`, and ⚙ are still clickable (not swallowed by the drag region). Kill the dev process.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/renderer/src/chrome/styles.css src/renderer/src/chrome/GroupBar.tsx
git commit -m "feat: merged title bar (frameless + window controls overlay) and settings cog"
```

---

### Task 4: Global page zoom (Ctrl+wheel, keys) wired through the store

**Files:**
- Modify: `src/main/tabs.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Apply zoom on view creation + add `setZoomAll`/`zoom-changed` in `src/main/tabs.ts`**

In `TabManager`, store the current zoom and apply it. Add a constructor-independent field and methods. First, in `openTab`, after `const wc = view.webContents` and before returning, apply current zoom:
```ts
    wc.on('did-finish-load', () => wc.setZoomLevel(this.zoom))
    wc.on('zoom-changed', (_e, dir: 'in' | 'out') => {
      this.onZoomStep?.(dir === 'in' ? 0.5 : -0.5)
    })
```
Add these members to the class:
```ts
  private zoom = 0
  onZoomStep?: (delta: number) => void

  setZoomAll(level: number) {
    this.zoom = level
    for (const view of this.views.values()) view.webContents.setZoomLevel(level)
  }
```
(Applying on `did-finish-load` covers pages that reset zoom on navigation; setting `this.zoom` in `setZoomAll` makes newly-created views pick it up in their own `did-finish-load`.)

- [ ] **Step 2: Add `applyZoom` funnel + keyboard + zoom-step wiring in `src/main/index.ts`**

Add a funnel function near `syncShownTab`:
```ts
function applyZoom(level: number) {
  store.setZoom(level) // clamps + emits (persist via onChange)
  tabs.setZoomAll(store.state.zoom)
  settings?.pushZoom(store.state.zoom)
}
```
(`settings` is the SettingsWindow manager added in Task 8; declare `let settings: SettingsWindow | undefined` alongside the other module lets now, and guard with `?.`. If Task 8 isn't done yet, `settings` is undefined and the call is skipped.)

In the `app.whenReady()` body, after `tabs = new TabManager(...)`, wire the wheel step and initial zoom:
```ts
  tabs.onZoomStep = (delta) => applyZoom(store.state.zoom + delta)
  tabs.setZoomAll(store.state.zoom) // apply persisted zoom to any views
```

In `wireShortcuts`, add these branches (inside the existing `before-input-event` handler, alongside the others):
```ts
    } else if (ctrl && (key === '=' || key === '+')) {
      event.preventDefault()
      applyZoom(store.state.zoom + 0.5)
    } else if (ctrl && key === '-') {
      event.preventDefault()
      applyZoom(store.state.zoom - 0.5)
    } else if (ctrl && key === '0') {
      event.preventDefault()
      applyZoom(0)
```

- [ ] **Step 3: Declare the `settings` let (temporary undefined) so `index.ts` compiles**

Near the top module lets (`let win`, `let store`, ...), add:
```ts
let settings: import('./settingsWindow').SettingsWindow | undefined
```
This resolves the type without importing at runtime yet. (Task 8 replaces it with a real import + assignment. `pushZoom` must exist on the type — it will, once Task 8 creates `settingsWindow.ts`. To build NOW before Task 8, temporarily type it as `{ pushZoom(z: number): void } | undefined` inline: `let settings: { pushZoom(z: number): void } | undefined`. Task 8 swaps this to the real type.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean; 36 tests pass (Task 1–2 added 9).

- [ ] **Step 5: Manual check**

`npm run dev` → open a tab, Ctrl+wheel zooms, Ctrl+=/-/0 work, and zoom is identical across two tabs. Restart → zoom level restored. Kill dev.

- [ ] **Step 6: Commit**

```bash
git add src/main/tabs.ts src/main/index.ts
git commit -m "feat: global page zoom via ctrl+wheel and keyboard, persisted"
```

---

### Task 5: Session colors (TDD) + tab color bars

**Files:**
- Create: `src/renderer/src/chrome/sessionColors.ts`
- Create: `tests/sessionColors.test.ts`
- Modify: `src/renderer/src/chrome/TabBar.tsx`
- Modify: `src/renderer/src/chrome/styles.css`

- [ ] **Step 1: Write failing tests `tests/sessionColors.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { assignSessionColors, SESSION_PALETTE } from '../src/renderer/src/chrome/sessionColors'
import type { GroupInfo } from '../src/shared/types'

const tab = (id: string, partition: string): any => ({ id, name: id, customName: false, url: '', partition })
const group = (id: string, tabs: any[]): GroupInfo => ({ id, name: id, tabs })

describe('assignSessionColors', () => {
  it('assigns no color to solo partitions', () => {
    const groups = [group('g', [tab('a', 'p1'), tab('b', 'p2')])]
    const colors = assignSessionColors(groups)
    expect(colors.get('p1')).toBeNull()
    expect(colors.get('p2')).toBeNull()
  })

  it('assigns a palette color to shared partitions, stable by first appearance', () => {
    const groups = [
      group('g', [tab('a', 'shared'), tab('b', 'shared'), tab('c', 'solo'), tab('d', 'other'), tab('e', 'other')])
    ]
    const colors = assignSessionColors(groups)
    expect(colors.get('shared')).toBe(SESSION_PALETTE[0])
    expect(colors.get('other')).toBe(SESSION_PALETTE[1])
    expect(colors.get('solo')).toBeNull()
  })

  it('counts shared partitions across all groups', () => {
    const groups = [group('g1', [tab('a', 'p')]), group('g2', [tab('b', 'p')])]
    const colors = assignSessionColors(groups)
    expect(colors.get('p')).toBe(SESSION_PALETTE[0]) // 2 tabs total, different groups
  })

  it('wraps palette when more than 8 shared partitions exist', () => {
    const tabs: any[] = []
    for (let i = 0; i < 9; i++) {
      tabs.push(tab(`a${i}`, `p${i}`), tab(`b${i}`, `p${i}`))
    }
    const colors = assignSessionColors([group('g', tabs)])
    expect(colors.get('p8')).toBe(SESSION_PALETTE[8 % SESSION_PALETTE.length])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/sessionColors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/renderer/src/chrome/sessionColors.ts`**

```ts
import type { GroupInfo } from '../../../shared/types'

/** 8-color palette for shared-session tab bars. */
export const SESSION_PALETTE = [
  '#61afef',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#c678dd',
  '#56b6c2',
  '#d19a66',
  '#ec6ea6'
]

/**
 * Maps each partition to a palette color when 2+ tabs share it, else null.
 * Colors are assigned by the partition's first appearance across all groups,
 * so they stay stable as tabs come and go.
 */
export function assignSessionColors(groups: GroupInfo[]): Map<string, string | null> {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const g of groups) {
    for (const t of g.tabs) {
      if (!counts.has(t.partition)) order.push(t.partition)
      counts.set(t.partition, (counts.get(t.partition) ?? 0) + 1)
    }
  }
  const result = new Map<string, string | null>()
  let sharedIdx = 0
  for (const partition of order) {
    if ((counts.get(partition) ?? 0) >= 2) {
      result.set(partition, SESSION_PALETTE[sharedIdx % SESSION_PALETTE.length])
      sharedIdx++
    } else {
      result.set(partition, null)
    }
  }
  return result
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sessionColors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Apply the color bar in `TabBar.tsx`**

Import and compute colors at the `TabBar` level, pass each tab its color, and render a top border. Replace the file's `TabBar` export and `TabChip` signature:

At the top of the file add:
```tsx
import { assignSessionColors } from './sessionColors'
```
Change `TabChip` to accept and apply a color:
```tsx
function TabChip({ tab, active, color }: { tab: TabInfo; active: boolean; color: string | null }) {
```
On the chip's root `<div>`, add an inline style for the top border (merge with existing className usage):
```tsx
      <div
        className={'chip' + (active ? ' active' : '')}
        style={color ? { borderTop: `2px solid ${color}` } : undefined}
        onClick={() => window.devb.activateTab(tab.id)}
```
Change `TabBar` to compute the map once and pass colors:
```tsx
export function TabBar({ group, activeTabId, groups }: { group: GroupInfo; activeTabId: string | null; groups: GroupInfo[] }) {
  const colors = assignSessionColors(groups)
  return (
    <div className="row tabs">
      {group.tabs.map((t) => (
        <TabChip key={t.id} tab={t} active={t.id === activeTabId} color={colors.get(t.partition) ?? null} />
      ))}
      <button className="add" title="New tab (fresh session)" onClick={() => window.devb.addTab(group.id)}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Pass `groups` to `TabBar` from `App.tsx`**

In `src/renderer/src/chrome/App.tsx`, update the `<TabBar ... />` usage to pass all groups:
```tsx
      <TabBar group={group} activeTabId={activeTabId} groups={state.groups} />
```

- [ ] **Step 7: Keep the 2px border from shifting layout**

In `styles.css`, give every chip a transparent top border so colored ones don't jump:
```css
.chip {
  border-top: 2px solid transparent;
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
```
(Replace the existing `.chip` block's opening — keep the remaining properties; the only additions are the `border-top` line. Ensure there is exactly one `.chip` rule.)

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean; tests pass (40 total).

- [ ] **Step 9: Manual check**

`npm run dev` → duplicate a tab → the original and duplicate show a matching colored top bar and sit next to each other; a solo tab has no bar. Kill dev.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/chrome/sessionColors.ts tests/sessionColors.test.ts src/renderer/src/chrome/TabBar.tsx src/renderer/src/chrome/App.tsx src/renderer/src/chrome/styles.css
git commit -m "feat: session color bars on shared-session tabs"
```

---

### Task 6: Vault — encrypted password CRUD (TDD)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/vault.ts`
- Create: `tests/vault.test.ts`

- [ ] **Step 1: Add types to `src/shared/types.ts`**

```ts
export interface PasswordEntry {
  id: string
  origin: string
  username: string
  secret: string // base64 safeStorage ciphertext
}

export interface SavedLogin {
  id: string
  username: string // no secret — secret is fetched on explicit selection
}
```

- [ ] **Step 2: Write failing tests `tests/vault.test.ts`**

The vault takes an injected `safeStorage`-like object and a file path so it is unit-testable. A fake encryptor (reversible, not real crypto) stands in.
```ts
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../src/main/vault'

// Fake safeStorage: reversible "encryption" so tests can assert round-trips
// without real DPAPI, and assert the on-disk secret is not plaintext.
const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, '')
}

describe('Vault', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-'))
    file = join(dir, 'passwords.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('adds and lists logins by origin, without secrets', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://localhost:3000', 'admin', 'pw1')
    v.add('http://localhost:3000', 'user', 'pw2')
    v.add('http://other', 'x', 'pw3')
    const list = v.list('http://localhost:3000')
    expect(list.map((l) => l.username).sort()).toEqual(['admin', 'user'])
    expect((list[0] as any).secret).toBeUndefined()
    expect(v.list('http://none')).toEqual([])
  })

  it('get() returns the decrypted password by id', () => {
    const v = new Vault(file, fakeSafe)
    const entry = v.add('http://x', 'u', 'sekret')
    expect(v.get(entry.id)).toBe('sekret')
    expect(v.get('missing')).toBeNull()
  })

  it('stores the secret encrypted, not as plaintext, on disk', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://x', 'u', 'sekret')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('sekret')
    expect(raw).toContain('u') // username is plaintext
  })

  it('dedupes identical (origin, username, password)', () => {
    const v = new Vault(file, fakeSafe)
    v.add('http://x', 'u', 'pw')
    v.add('http://x', 'u', 'pw')
    expect(v.list('http://x')).toHaveLength(1)
  })

  it('updates the secret when the same (origin, username) has a new password', () => {
    const v = new Vault(file, fakeSafe)
    const a = v.add('http://x', 'u', 'old')
    const b = v.add('http://x', 'u', 'new')
    expect(a.id).toBe(b.id) // same entry, updated in place
    expect(v.get(b.id)).toBe('new')
    expect(v.list('http://x')).toHaveLength(1)
  })

  it('remove() deletes an entry', () => {
    const v = new Vault(file, fakeSafe)
    const e = v.add('http://x', 'u', 'pw')
    v.remove(e.id)
    expect(v.list('http://x')).toHaveLength(0)
  })

  it('never()/isNever() track an ignore list', () => {
    const v = new Vault(file, fakeSafe)
    expect(v.isNever('http://x')).toBe(false)
    v.never('http://x')
    expect(v.isNever('http://x')).toBe(true)
  })

  it('persists across instances (reload from disk)', () => {
    const v1 = new Vault(file, fakeSafe)
    v1.add('http://x', 'u', 'pw')
    v1.never('http://y')
    const v2 = new Vault(file, fakeSafe)
    expect(v2.get(v2.list('http://x')[0].id)).toBe('pw')
    expect(v2.isNever('http://y')).toBe(true)
  })

  it('is disabled and never persists plaintext when encryption is unavailable', () => {
    const off = { ...fakeSafe, isEncryptionAvailable: () => false }
    const v = new Vault(file, off)
    expect(v.available).toBe(false)
    const e = v.add('http://x', 'u', 'pw')
    expect(e).toBeNull()
    expect(v.list('http://x')).toHaveLength(0)
  })

  it('starts empty on a corrupt file', () => {
    const { writeFileSync } = require('node:fs')
    writeFileSync(file, '{bad json')
    const v = new Vault(file, fakeSafe)
    expect(v.list('http://x')).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/vault.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/main/vault.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PasswordEntry, SavedLogin } from '../shared/types'

/** Minimal shape of Electron's safeStorage, injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

interface VaultFile {
  entries: PasswordEntry[]
  neverOrigins: string[]
}

/** Encrypted password store. Secrets are safeStorage ciphertext (base64); origin/username plaintext. */
export class Vault {
  readonly available: boolean
  private data: VaultFile = { entries: [], neverOrigins: [] }

  constructor(
    private file: string,
    private safe: SafeStorageLike
  ) {
    this.available = safe.isEncryptionAvailable()
    this.load()
  }

  private load() {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed.entries) && Array.isArray(parsed.neverOrigins)) {
        this.data = parsed
      }
    } catch {
      this.data = { entries: [], neverOrigins: [] }
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  /** Returns the entry, or null if encryption is unavailable. Updates in place on (origin,username) match. */
  add(origin: string, username: string, password: string): PasswordEntry | null {
    if (!this.available) return null
    const secret = this.safe.encryptString(password).toString('base64')
    const existing = this.data.entries.find((e) => e.origin === origin && e.username === username)
    if (existing) {
      existing.secret = secret
      this.save()
      return existing
    }
    const entry: PasswordEntry = { id: randomUUID(), origin, username, secret }
    this.data.entries.push(entry)
    this.save()
    return entry
  }

  list(origin: string): SavedLogin[] {
    return this.data.entries
      .filter((e) => e.origin === origin)
      .map((e) => ({ id: e.id, username: e.username }))
  }

  get(id: string): string | null {
    const entry = this.data.entries.find((e) => e.id === id)
    if (!entry) return null
    try {
      return this.safe.decryptString(Buffer.from(entry.secret, 'base64'))
    } catch {
      return null
    }
  }

  remove(id: string) {
    this.data.entries = this.data.entries.filter((e) => e.id !== id)
    this.save()
  }

  allOrigins(): string[] {
    return [...new Set(this.data.entries.map((e) => e.origin))]
  }

  never(origin: string) {
    if (!this.data.neverOrigins.includes(origin)) {
      this.data.neverOrigins.push(origin)
      this.save()
    }
  }

  isNever(origin: string): boolean {
    return this.data.neverOrigins.includes(origin)
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/vault.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Full suite + tsc + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (51 tests).
```bash
git add src/shared/types.ts src/main/vault.ts tests/vault.test.ts
git commit -m "feat: encrypted password vault (safeStorage-injected, tested)"
```

---

### Task 7: Autofill preload script + bridge + config

**Files:**
- Create: `src/renderer/autofill-preload.ts`
- Create: `src/main/autofillBridge.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/main/tabs.ts` (attach the autofill preload)
- Modify: `src/preload/index.ts` (save-prompt + openSettings channels)

- [ ] **Step 1: Add build inputs in `electron.vite.config.ts`**

The preload build needs both the main preload and the autofill preload; the renderer build needs the settings entry (Task 8 uses it). Update the config:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'autofill-preload': resolve(__dirname, 'src/renderer/autofill-preload.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          chrome: resolve(__dirname, 'src/renderer/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
```
Note: `settings.html` is created in Task 8; create a placeholder now so the build doesn't fail:
Create `src/renderer/settings.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Settings</title></head>
  <body><div id="root"></div></body>
</html>
```
(The autofill-preload is built into `out/preload/autofill-preload.js`.)

- [ ] **Step 2: Write `src/renderer/autofill-preload.ts`**

This runs in each tab's isolated content world. It talks to main via `ipcRenderer` (available in a preload even with contextIsolation). It captures submits and renders a shadow-root dropdown.
```ts
import { ipcRenderer } from 'electron'

function originOf(): string {
  return location.origin
}

// --- Save capture: watch for login-form submits ---
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

// --- Autofill dropdown ---
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

window.addEventListener('DOMContentLoaded', refreshLogins)
refreshLogins()
```

- [ ] **Step 3: Write `src/main/autofillBridge.ts`**

```ts
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Vault } from './vault'

/**
 * Wires the injected autofill preload to the Vault.
 * onCapture is called when a login is submitted and NOT already known/ignored,
 * so the caller can show the save prompt in the chrome UI.
 */
export function registerAutofill(
  vault: Vault,
  getChromeWindow: () => BrowserWindow,
  onCapture: (data: { origin: string; username: string; password: string }) => void
) {
  ipcMain.handle('autofill:query', (_e, origin: string) => vault.list(origin))
  ipcMain.handle('autofill:secret', (_e, id: string) => vault.get(id))
  ipcMain.on('autofill:captured', (_e, data: { origin: string; username: string; password: string }) => {
    if (!data || !data.password) return
    if (vault.isNever(data.origin)) return
    // Suppress if an identical credential already exists.
    const existing = vault.list(data.origin).some((l) => l.username === data.username)
    if (existing) {
      const currentId = vault.list(data.origin).find((l) => l.username === data.username)?.id
      if (currentId && vault.get(currentId) === data.password) return
    }
    onCapture(data)
  })
}
```

- [ ] **Step 4: Attach the autofill preload to each tab view in `src/main/tabs.ts`**

In `openTab`, add the preload to `webPreferences`. Change the `new WebContentsView({...})` line:
```ts
    const view = new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload: join(__dirname, 'autofill-preload.js')
      }
    })
```
Add the import at the top of `tabs.ts` if not present:
```ts
import { join } from 'node:path'
```
(The autofill preload is emitted to `out/preload/autofill-preload.js`; `__dirname` in the main bundle is `out/main`, so `join(__dirname, 'autofill-preload.js')` is wrong — use `join(__dirname, '../preload/autofill-preload.js')`.) Use:
```ts
        preload: join(__dirname, '../preload/autofill-preload.js')
```

- [ ] **Step 5: Add preload channels in `src/preload/index.ts`**

Add to the `api` object:
```ts
  openSettings: (): Promise<void> => ipcRenderer.invoke('settings:open'),
  onSavePrompt: (cb: (data: { origin: string; username: string }) => void) => {
    const h = (_e: IpcRendererEvent, d: { origin: string; username: string }) => cb(d)
    ipcRenderer.on('chrome:savePrompt', h)
    return (): void => {
      ipcRenderer.removeListener('chrome:savePrompt', h)
    }
  },
  savePassword: (accept: boolean): Promise<void> => ipcRenderer.invoke('save:decide', accept),
```
(The save prompt carries the pending credential in the main process; the renderer only sends the user's decision `accept`. "Never" is a separate channel:)
```ts
  neverSave: (): Promise<void> => ipcRenderer.invoke('save:never'),
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; `out/preload/autofill-preload.js` emitted; settings placeholder builds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/autofill-preload.ts src/main/autofillBridge.ts electron.vite.config.ts src/renderer/settings.html src/main/tabs.ts src/preload/index.ts
git commit -m "feat: autofill preload, bridge, and preload channels"
```

---

### Task 8: Settings window + save prompt + full wiring

**Files:**
- Create: `src/main/settingsWindow.ts`
- Create: `src/renderer/src/settings/{main.tsx,Settings.tsx,styles.css}`
- Modify: `src/renderer/settings.html`
- Modify: `src/main/index.ts` (wire vault, autofill, settings, save-prompt state, zoom push)
- Modify: `src/preload/index.ts` (settings-side channels)
- Modify: `src/renderer/src/chrome/{App.tsx, SavePrompt.tsx}`

- [ ] **Step 1: Write `src/main/settingsWindow.ts`**

```ts
import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { Vault } from './vault'

/** Single-instance settings window; talks to the Vault and pushes zoom updates. */
export class SettingsWindow {
  private win: BrowserWindow | null = null

  constructor(
    private vault: Vault,
    private getZoom: () => number,
    private onSetZoom: (level: number) => void
  ) {
    ipcMain.handle('settings:list', () => this.snapshot())
    ipcMain.handle('settings:reveal', (_e, id: string) => this.vault.get(id))
    ipcMain.handle('settings:delete', (_e, id: string) => {
      this.vault.remove(id)
      return this.snapshot()
    })
    ipcMain.handle('settings:setZoom', (_e, level: number) => {
      this.onSetZoom(level)
    })
    ipcMain.handle('settings:getZoom', () => this.getZoom())
  }

  private snapshot() {
    return {
      origins: this.vault.allOrigins().map((origin) => ({
        origin,
        logins: this.vault.list(origin)
      })),
      available: this.vault.available
    }
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus()
      return
    }
    this.win = new BrowserWindow({
      width: 560,
      height: 560,
      title: 'Settings',
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js') }
    })
    this.win.on('closed', () => (this.win = null))
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/settings.html'))
    }
  }

  pushZoom(level: number) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('settings:zoom', level)
  }
}
```

- [ ] **Step 2: Add settings-side channels to `src/preload/index.ts`**

Add to the `api` object:
```ts
  settingsList: (): Promise<{ origins: { origin: string; logins: { id: string; username: string }[] }[]; available: boolean }> =>
    ipcRenderer.invoke('settings:list'),
  settingsReveal: (id: string): Promise<string | null> => ipcRenderer.invoke('settings:reveal', id),
  settingsDelete: (id: string): Promise<{ origins: { origin: string; logins: { id: string; username: string }[] }[]; available: boolean }> =>
    ipcRenderer.invoke('settings:delete', id),
  settingsGetZoom: (): Promise<number> => ipcRenderer.invoke('settings:getZoom'),
  settingsSetZoom: (level: number): Promise<void> => ipcRenderer.invoke('settings:setZoom', level),
  onSettingsZoom: (cb: (level: number) => void) => {
    const h = (_e: IpcRendererEvent, z: number) => cb(z)
    ipcRenderer.on('settings:zoom', h)
    return (): void => {
      ipcRenderer.removeListener('settings:zoom', h)
    }
  },
```

- [ ] **Step 3: Write `src/renderer/settings.html`** (replace the placeholder)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/settings/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/renderer/src/settings/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react'

interface Snapshot {
  origins: { origin: string; logins: { id: string; username: string }[] }[]
  available: boolean
}

function zoomPct(level: number): string {
  return `${Math.round(100 * 1.2 ** level)}%`
}

export function Settings() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [zoom, setZoom] = useState(0)
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  useEffect(() => {
    window.devb.settingsList().then(setSnap)
    window.devb.settingsGetZoom().then(setZoom)
    return window.devb.onSettingsZoom(setZoom)
  }, [])

  const setZoomLevel = (level: number) => {
    window.devb.settingsSetZoom(level)
    setZoom(level)
  }

  return (
    <div className="settings">
      <h2>Zoom</h2>
      <div className="zoom-row">
        <button onClick={() => setZoomLevel(Math.max(-3, zoom - 0.5))}>−</button>
        <span className="pct">{zoomPct(zoom)}</span>
        <button onClick={() => setZoomLevel(Math.min(3, zoom + 0.5))}>＋</button>
        <button onClick={() => setZoomLevel(0)}>Reset to 100%</button>
      </div>

      <h2>Saved passwords</h2>
      {snap && !snap.available && <p className="warn">OS encryption unavailable — saving is disabled.</p>}
      {snap?.origins.length === 0 && <p className="dim">No saved passwords yet.</p>}
      {snap?.origins.map((o) => (
        <div key={o.origin} className="origin">
          <div className="origin-name">{o.origin}</div>
          {o.logins.map((l) => (
            <div key={l.id} className="login">
              <span className="user">{l.username}</span>
              <span className="secret">{revealed[l.id] ?? '••••••••'}</span>
              <button
                onClick={async () => {
                  const pw = await window.devb.settingsReveal(l.id)
                  if (pw != null) setRevealed((r) => ({ ...r, [l.id]: pw }))
                }}
              >
                Reveal
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText((await window.devb.settingsReveal(l.id)) ?? '')
                }}
              >
                Copy
              </button>
              <button
                onClick={async () => {
                  setSnap(await window.devb.settingsDelete(l.id))
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ))}

      <h2>Shortcuts</h2>
      <table className="keys">
        <tbody>
          <tr><td>Ctrl+T / Ctrl+W</td><td>New / close tab</td></tr>
          <tr><td>Ctrl+Tab</td><td>Next tab (wraps)</td></tr>
          <tr><td>Ctrl+Shift+Tab</td><td>Next group (wraps)</td></tr>
          <tr><td>Ctrl+L</td><td>Focus address bar</td></tr>
          <tr><td>Ctrl+R</td><td>Reload</td></tr>
          <tr><td>Ctrl+= / Ctrl+- / Ctrl+0</td><td>Zoom in / out / reset</td></tr>
          <tr><td>Ctrl+wheel</td><td>Zoom</td></tr>
          <tr><td>F12 / Ctrl+Shift+F12</td><td>API panel / DevTools</td></tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/settings/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client'
import { Settings } from './Settings'
import './styles.css'

createRoot(document.getElementById('root')!).render(<Settings />)
```

- [ ] **Step 6: Write `src/renderer/src/settings/styles.css`**

```css
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font: 13px system-ui, sans-serif;
  background: #1b1e24;
  color: #d8dbe2;
}
.settings {
  padding: 16px 20px;
}
.settings h2 {
  font-size: 14px;
  color: #9aa0ab;
  border-bottom: 1px solid #2e3440;
  padding-bottom: 4px;
  margin: 20px 0 10px;
}
.settings h2:first-child {
  margin-top: 0;
}
.zoom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zoom-row .pct {
  min-width: 52px;
  text-align: center;
}
button {
  background: #2e3440;
  border: none;
  border-radius: 4px;
  color: #d8dbe2;
  cursor: pointer;
  padding: 4px 10px;
}
button:hover {
  background: #3a4150;
}
.origin-name {
  color: #61afef;
  margin: 8px 0 4px;
}
.login {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.login .user {
  min-width: 120px;
}
.login .secret {
  flex: 1;
  color: #9aa0ab;
  font-family: ui-monospace, Consolas, monospace;
}
.warn {
  color: #e5c07b;
}
.dim {
  color: #5c6370;
}
.keys {
  border-collapse: collapse;
}
.keys td {
  padding: 3px 16px 3px 0;
}
.keys td:first-child {
  color: #61afef;
  font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap;
}
```

- [ ] **Step 7: Write `src/renderer/src/chrome/SavePrompt.tsx`**

```tsx
import { useEffect, useState } from 'react'

export function SavePrompt() {
  const [prompt, setPrompt] = useState<{ origin: string; username: string } | null>(null)

  useEffect(() => window.devb.onSavePrompt(setPrompt), [])

  if (!prompt) return null
  return (
    <div className="save-prompt">
      <span>
        Save password for <b>{prompt.username || '(no username)'}</b> @ {prompt.origin}?
      </span>
      <button
        onClick={() => {
          window.devb.savePassword(true)
          setPrompt(null)
        }}
      >
        Save
      </button>
      <button
        onClick={() => {
          window.devb.neverSave()
          setPrompt(null)
        }}
      >
        Never
      </button>
      <button
        className="x"
        onClick={() => {
          window.devb.savePassword(false)
          setPrompt(null)
        }}
      >
        ✕
      </button>
    </div>
  )
}
```
Add its styles to `src/renderer/src/chrome/styles.css`:
```css
.save-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #21262e;
  border-top: 1px solid #2e3440;
  font-size: 12px;
}
.save-prompt button {
  background: #2e3440;
  border: none;
  border-radius: 4px;
  color: #d8dbe2;
  cursor: pointer;
  padding: 3px 10px;
}
.save-prompt .x {
  margin-left: auto;
  background: none;
}
```

- [ ] **Step 8: Render `SavePrompt` in `App.tsx`**

In `src/renderer/src/chrome/App.tsx`, import and render it below `AddressBar`:
```tsx
import { SavePrompt } from './SavePrompt'
```
```tsx
      <AddressBar tab={activeTab} />
      <SavePrompt />
```

- [ ] **Step 9: Wire everything in `src/main/index.ts`**

Add imports:
```ts
import { safeStorage } from 'electron'
import { Vault } from './vault'
import { registerAutofill } from './autofillBridge'
import { SettingsWindow } from './settingsWindow'
```
Replace the temporary `let settings: {...}` declaration with the real type:
```ts
let settings: SettingsWindow
let vault: Vault
let pendingSave: { origin: string; username: string; password: string } | null = null
```
In `app.whenReady()`, after `panels = new PanelManager(...)`, construct the vault/settings/autofill and wire the save prompt:
```ts
  vault = new Vault(join(app.getPath('userData'), 'passwords.json'), safeStorage)
  settings = new SettingsWindow(
    vault,
    () => store.state.zoom,
    (level) => applyZoom(level)
  )
  registerAutofill(
    vault,
    () => win,
    (data) => {
      pendingSave = data
      win.webContents.send('chrome:savePrompt', { origin: data.origin, username: data.username })
    }
  )
```
Add IPC handlers in `registerIpc()`:
```ts
  ipcMain.handle('settings:open', () => settings.open())
  ipcMain.handle('save:decide', (_e, accept: boolean) => {
    if (accept && pendingSave) vault.add(pendingSave.origin, pendingSave.username, pendingSave.password)
    pendingSave = null
  })
  ipcMain.handle('save:never', () => {
    if (pendingSave) vault.never(pendingSave.origin)
    pendingSave = null
  })
```
Now that `settings` is a real `SettingsWindow`, the `applyZoom` funnel's `settings?.pushZoom(...)` call should be `settings.pushZoom(...)` (it always exists after whenReady). Update `applyZoom`:
```ts
function applyZoom(level: number) {
  store.setZoom(level)
  tabs.setZoomAll(store.state.zoom)
  settings.pushZoom(store.state.zoom)
}
```
(Because `applyZoom` is only ever called after `whenReady` wiring — via shortcuts, zoom-step, or settings — `settings` is defined at every call site.)

- [ ] **Step 10: Add the `Ctrl+Tab` / `Ctrl+Shift+Tab` branches in `wireShortcuts` (`src/main/index.ts`)**

Inside the `before-input-event` handler, add:
```ts
    } else if (ctrl && key === 'tab') {
      event.preventDefault()
      if (input.shift) store.nextGroup()
      else store.nextTab()
```
(Place this before the generic branches; `key` is already `input.key.toLowerCase()`, and `Tab` lowercases to `'tab'`.)

- [ ] **Step 11: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean; 51 tests pass; chrome/panel/settings all bundle; `autofill-preload.js` present.

- [ ] **Step 12: Manual smoke of the whole feature set**

`npm run dev` and verify:
1. ⚙ opens the settings window; Zoom −/＋/Reset changes the live pages and the % display; changing zoom via Ctrl+wheel updates the settings % live.
2. On a real login page (e.g. github.com), submit a login → save bar appears → Save. Reopen settings → the credential is listed under its origin; Reveal shows it; Delete removes it.
3. Revisit that login page → focus the username/password field → dropdown lists the saved account → clicking fills both fields (no auto-submit).
4. "Never" on the save bar suppresses future prompts for that origin.
5. Ctrl+Tab cycles tabs, Ctrl+Shift+Tab cycles groups.
Kill dev.

- [ ] **Step 13: Commit**

```bash
git add src/main/settingsWindow.ts src/renderer/settings.html src/renderer/src/settings src/renderer/src/chrome/SavePrompt.tsx src/renderer/src/chrome/App.tsx src/renderer/src/chrome/styles.css src/main/index.ts src/preload/index.ts
git commit -m "feat: settings window, password save prompt, autofill wiring, tab/group hotkeys"
```

---

### Task 9: Final pass — full verification + checklist update

**Files:**
- Modify: `docs/superpowers/smoke-checklist.md`

- [ ] **Step 1: Append v1.1 items to `docs/superpowers/smoke-checklist.md`**

```markdown

## v1.1 additions

- [ ] Duplicate a tab → original + duplicate show a matching color bar and are adjacent; solo tabs have no bar
- [ ] Ctrl+Tab cycles tabs forward (wraps); Ctrl+Shift+Tab cycles groups forward (wraps)
- [ ] No OS title bar; native min/max/close work top-right; window drags by the group row; nothing renders under the buttons
- [ ] Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0 zoom all tabs together; level survives restart
- [ ] Settings (⚙) opens; Zoom control matches and drives page zoom
- [ ] Login submit → save bar → Save persists (Reveal in settings shows it); Never suppresses that origin
- [ ] Autofill dropdown lists saved accounts for the site; selecting fills username+password; never auto-submits; no fill inside cross-origin iframes
- [ ] passwords.json on disk contains no plaintext password
```

- [ ] **Step 2: Full automated gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 51 tests pass; tsc clean; build succeeds.

- [ ] **Step 3: Rebuild the exe and boot-check**

Run: `npm run dist`
Expected: `release/DevBrowser 0.1.0.exe` (portable) + installer rebuilt. Launch the portable exe, confirm it opens, kill it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/smoke-checklist.md
git commit -m "docs: v1.1 smoke checklist"
```

---

## Notes for the implementer

- **Autofill preload path:** the injected script is built to `out/preload/autofill-preload.js` (a `preload` rollup input), and attached via `join(__dirname, '../preload/autofill-preload.js')` from the main bundle (`out/main`). Do not confuse it with the renderer bundles.
- **safeStorage timing:** only valid after `app.whenReady()`. The `Vault` is constructed inside `whenReady`, so `isEncryptionAvailable()` is safe.
- **Zoom units:** `setZoomLevel` is logarithmic (each ±1 ≈ ×1.2). The clamp [-3, 3] ≈ 58%–173%; the ±0.5 step is a gentle zoom. The settings `zoomPct` uses `1.2 ** level` to display the matching percentage.
- **`key` matching:** `input.key` for the Tab key is `'Tab'` → `'tab'` after lowercasing; for zoom, the physical `=` key reports `'='` (and `'+'` with shift), `'-'` reports `'-'`, `'0'` reports `'0'`.
- **Security invariants (do not weaken):** `autofill:secret` returns a password only for an explicit `id` the renderer selected; the dropdown never pre-fills on load; `location.origin` gating means an iframe from another origin runs its own preload instance with its own `location.origin`, so it can only ever request its own origin's logins — cross-origin fill is structurally prevented.
- **No auto-submit:** `fillInto` dispatches only `input`/`change` events, never a submit.
- Test counts assume v1's 27 + Task 1 (7) + Task 2 (2) + Task 5 (4) + Task 6 (11) = 51.
