import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeCard } from '../testkit'
import { DRAFT_KEY } from './storage'
import { useDraft } from './useDraft'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

function otherTabDraft(word: string): string {
  return JSON.stringify({
    schema: 1,
    deckId: 1,
    baseRevision: 42,
    items: { 'tmp-1': { kind: 'create', card: makeCard({ word }) } },
    imports: [],
  })
}

function tabWrote(): void {
  window.dispatchEvent(new StorageEvent('storage', { key: DRAFT_KEY }))
}

afterEach(cleanup)

describe('useDraft', () => {
  it('starts empty on the server revision and stores nothing', () => {
    const storage = memoryStorage()
    const { result } = renderHook(() => useDraft(1, 42, storage))
    expect(result.current.draft.baseRevision).toBe(42)
    expect(result.current.notice).toBeNull()
    expect(storage.data.has(DRAFT_KEY)).toBe(false)
  })

  it('saves edits and restores them on the next mount', () => {
    const storage = memoryStorage()
    const first = renderHook(() => useDraft(1, 42, storage))
    act(() => first.result.current.dispatch({ type: 'upsertCreate', key: 'tmp-1', card: makeCard({ word: 'luggage' }) }))
    expect(storage.data.has(DRAFT_KEY)).toBe(true)
    first.unmount()

    const second = renderHook(() => useDraft(1, 42, storage))
    expect(Object.keys(second.result.current.draft.items)).toEqual(['tmp-1'])
  })

  it('an empty draft follows the server revision, a non-empty one keeps its base', () => {
    const storage = memoryStorage()
    const { result, rerender } = renderHook(({ rev }) => useDraft(1, rev, storage), { initialProps: { rev: 42 } })
    rerender({ rev: 43 })
    expect(result.current.draft.baseRevision).toBe(43)

    act(() => result.current.dispatch({ type: 'upsertCreate', key: 'tmp-1', card: makeCard() }))
    rerender({ rev: 44 })
    expect(result.current.draft.baseRevision).toBe(43)
  })

  it('reports a reset when the saved draft belongs to another deck', () => {
    const storage = memoryStorage()
    storage.setItem(DRAFT_KEY, otherTabDraft('x'))
    const { result } = renderHook(() => useDraft(2, 42, storage))
    expect(result.current.notice).toBe('deck')
    expect(Object.keys(result.current.draft.items)).toEqual([])
    act(() => result.current.dismissNotice())
    expect(result.current.notice).toBeNull()
  })

  it('pauses saving after a change in another tab and lets the user decide', () => {
    const storage = memoryStorage()
    const { result } = renderHook(() => useDraft(1, 42, storage))
    act(() => result.current.dispatch({ type: 'upsertCreate', key: 'tmp-1', card: makeCard({ word: 'mine' }) }))

    storage.setItem(DRAFT_KEY, otherTabDraft('theirs'))
    act(() => tabWrote())
    expect(result.current.externalChange).toBe(true)

    act(() => result.current.dispatch({ type: 'upsertCreate', key: 'tmp-2', card: makeCard({ word: 'mine2' }) }))
    expect(Object.keys(JSON.parse(storage.data.get(DRAFT_KEY) ?? '{}').items)).toEqual(['tmp-1'])

    act(() => result.current.acceptExternal())
    expect(result.current.externalChange).toBe(false)
    expect(Object.keys(result.current.draft.items)).toEqual(['tmp-1'])
    const kept = result.current.draft.items['tmp-1']
    expect(kept.kind === 'create' && kept.card.word).toBe('theirs')
  })

  it('keepMine overwrites the other tab copy', () => {
    const storage = memoryStorage()
    const { result } = renderHook(() => useDraft(1, 42, storage))
    act(() => result.current.dispatch({ type: 'upsertCreate', key: 'tmp-1', card: makeCard({ word: 'mine' }) }))
    storage.setItem(DRAFT_KEY, otherTabDraft('theirs'))
    act(() => tabWrote())

    act(() => result.current.keepMine())
    expect(result.current.externalChange).toBe(false)
    const stored = JSON.parse(storage.data.get(DRAFT_KEY) ?? '{}')
    expect(stored.items['tmp-1'].card.word).toBe('mine')
  })

  it('ignores storage events for other keys', () => {
    const storage = memoryStorage()
    const { result } = renderHook(() => useDraft(1, 42, storage))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'em-theme' }))
    })
    expect(result.current.externalChange).toBe(false)
  })

  describe('when the storage is full', () => {
    function fullStorage() {
      const storage = memoryStorage()
      let full = true
      return {
        ...storage,
        setItem: (key: string, value: string) => {
          if (full) throw new DOMException('quota', 'QuotaExceededError')
          storage.setItem(key, value)
        },
        free: () => {
          full = false
        },
        fill: () => {
          full = true
        },
      }
    }
    const add = (word: string) => ({ type: 'upsertCreate' as const, key: `tmp-${word.length}`, card: makeCard({ word }) })

    it('reports once, however many changes follow, and keeps working in memory', () => {
      const storage = fullStorage()
      const onSaveFailed = vi.fn<() => void>()
      const { result } = renderHook(() => useDraft(1, 42, storage, onSaveFailed))
      expect(onSaveFailed).not.toHaveBeenCalled()

      act(() => result.current.dispatch(add('one')))
      act(() => result.current.dispatch(add('three')))
      expect(onSaveFailed).toHaveBeenCalledTimes(1)
      expect(Object.keys(result.current.draft.items)).toHaveLength(2)
    })

    it('reports again after a successful save followed by a new failure', () => {
      const storage = fullStorage()
      const onSaveFailed = vi.fn<() => void>()
      const { result } = renderHook(() => useDraft(1, 42, storage, onSaveFailed))

      act(() => result.current.dispatch(add('one')))
      storage.free()
      act(() => result.current.dispatch(add('three')))
      storage.fill()
      act(() => result.current.dispatch(add('seven')))
      expect(onSaveFailed).toHaveBeenCalledTimes(2)
    })

    it('stays silent when the storage works', () => {
      const storage = memoryStorage()
      const onSaveFailed = vi.fn<() => void>()
      const { result } = renderHook(() => useDraft(1, 42, storage, onSaveFailed))
      act(() => result.current.dispatch(add('one')))
      expect(onSaveFailed).not.toHaveBeenCalled()
    })
  })
})
