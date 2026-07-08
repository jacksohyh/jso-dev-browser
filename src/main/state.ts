import { randomUUID } from 'node:crypto'
import type { AppState, GroupInfo, TabInfo } from '../shared/types'

export function newPartition(): string {
  return `persist:tab-${randomUUID()}`
}

export function createInitialState(): AppState {
  const g: GroupInfo = { id: randomUUID(), name: 'Group 1', tabs: [] }
  return { groups: [g], activeGroupId: g.id, activeTabByGroup: {}, zoom: 0 }
}

/** Single source of truth for groups/tabs/sessions. Pure data — no Electron. */
export class AppStore {
  /** Fires synchronously after each mutation. Handlers must not re-enter store mutators. */
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

  /**
   * Removes the group; returns its tabs so the caller can destroy views/sessions.
   * Session cleanup contract: for each returned tab, check isPartitionInUse(tab.partition)
   * AFTER this returns — a partition may still be used by a tab in another group
   * (cross-group duplicate). Only clear storage when it reports false.
   */
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

  setZoom(level: number) {
    if (!Number.isFinite(level)) return
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

  isPartitionInUse(partition: string): boolean {
    return this.state.groups.some((g) => g.tabs.some((t) => t.partition === partition))
  }
}
