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
