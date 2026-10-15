import { describe, expect, it } from 'vitest'
import { makeCard } from '../testkit'
import { draftReducer, emptyDraft, type Draft } from './draft'
import { DRAFT_KEY, loadDraft, parseDraft, saveDraft, clearDraft } from './storage'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

function sampleDraft(): Draft {
  let draft = emptyDraft(1, 42)
  draft = draftReducer(draft, { type: 'upsertCreate', key: 'tmp-1', card: makeCard({ word: 'luggage' }) })
  draft = draftReducer(draft, { type: 'upsertUpdate', id: 102, baseVersion: 2, base: makeCard(), card: makeCard({ translation: 'иначе' }) })
  draft = draftReducer(draft, { type: 'archive', id: 104, baseVersion: 1, base: makeCard({ word: 'old' }) })
  draft = draftReducer(draft, { type: 'restore', id: 87, baseVersion: 3, base: makeCard({ word: 'back' }) })
  draft = draftReducer(draft, {
    type: 'addImport',
    file: { fileName: 'travel.json', cards: [makeCard({ word: 'delay' })], preview: { added: 1, skipped: 0, errors: 2 } },
  })
  return draftReducer(draft, { type: 'setMessage', message: 'Откат к r40' })
}

describe('draft storage', () => {
  it('round-trips a draft through localStorage', () => {
    const storage = memoryStorage()
    const draft = sampleDraft()
    expect(saveDraft(storage, draft)).toBe(true)
    expect(storage.data.has(DRAFT_KEY)).toBe(true)
    expect(loadDraft(storage, 1)).toEqual({ draft, notice: null })
  })

  it('stores nothing for an empty draft and removes the old copy', () => {
    const storage = memoryStorage()
    saveDraft(storage, sampleDraft())
    saveDraft(storage, emptyDraft(1, 43))
    expect(storage.data.has(DRAFT_KEY)).toBe(false)
    expect(loadDraft(storage, 1)).toEqual({ draft: null, notice: null })
  })

  it('resets a draft from another schema', () => {
    const raw = JSON.stringify({ ...sampleDraft(), schema: 2 })
    expect(parseDraft(raw, 1)).toEqual({ draft: null, notice: 'schema' })
  })

  it('resets a draft of another deck', () => {
    expect(parseDraft(JSON.stringify(sampleDraft()), 2)).toEqual({ draft: null, notice: 'deck' })
  })

  it('resets corrupt data instead of crashing', () => {
    expect(parseDraft('{not json', 1).notice).toBe('corrupt')
    expect(parseDraft('[]', 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), items: { '1': { kind: 'update' } } }), 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), items: { '1': { kind: 'wat' } } }), 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), baseRevision: 'r42' }), 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), imports: [{ fileName: 'x' }] }), 1).notice).toBe('corrupt')
  })

  it('reports an unavailable storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadDraft(broken, 1)).toEqual({ draft: null, notice: null })
    expect(saveDraft(broken, sampleDraft())).toBe(false)
    expect(clearDraft(broken)).toBe(false)
  })

  it('round-trips a restore with edits', () => {
    const storage = memoryStorage()
    const draft = draftReducer(emptyDraft(1, 42), { type: 'restore', id: 87, baseVersion: 3, base: makeCard() })
    const withEdit = draftReducer(draft, { type: 'upsertUpdate', id: 87, baseVersion: 3, base: makeCard(), card: makeCard({ translation: 'иначе' }) })
    expect(withEdit.items['87']).toEqual({ kind: 'restore', baseVersion: 3, base: makeCard(), card: makeCard({ translation: 'иначе' }) })
    saveDraft(storage, withEdit)
    expect(loadDraft(storage, 1)).toEqual({ draft: withEdit, notice: null })
  })

  it('keeps the message and drops nothing else', () => {
    const storage = memoryStorage()
    saveDraft(storage, sampleDraft())
    expect(loadDraft(storage, 1).draft?.message).toBe('Откат к r40')
  })

  it('rejects every malformed item shape', () => {
    const good = makeCard()
    const shapes: unknown[] = [
      { kind: 'create' },
      { kind: 'create', card: { ...good, word: 5 } },
      { kind: 'update', baseVersion: 0, base: good, card: good },
      { kind: 'update', baseVersion: 1.5, base: good, card: good },
      { kind: 'update', baseVersion: 1, base: good },
      { kind: 'archive', baseVersion: 1 },
      { kind: 'archive', baseVersion: -1, base: good },
      { kind: 'restore', baseVersion: 1 },
      { kind: 'restore', base: good },
      { kind: 'restore', baseVersion: 1, base: good, card: { word: 'x' } },
      'text',
      null,
    ]
    for (const shape of shapes) {
      const raw = JSON.stringify({ ...sampleDraft(), items: { '1': shape } })
      expect(parseDraft(raw, 1).notice).toBe('corrupt')
    }
  })

  it('rejects malformed import files', () => {
    const good = makeCard()
    const preview = { added: 1, skipped: 0, errors: 0 }
    const shapes: unknown[] = [
      { fileName: 5, cards: [good], preview },
      { fileName: 'a.json', cards: 'x', preview },
      { fileName: 'a.json', cards: [{ word: 'x' }], preview },
      { fileName: 'a.json', cards: [good] },
      { fileName: 'a.json', cards: [good], preview: { added: '1', skipped: 0, errors: 0 } },
    ]
    for (const shape of shapes) {
      const raw = JSON.stringify({ ...sampleDraft(), imports: [shape] })
      expect(parseDraft(raw, 1).notice).toBe('corrupt')
    }
  })

  it('rejects a draft without items or imports and a non-numeric deck', () => {
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), items: [] }), 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), imports: {} }), 1).notice).toBe('corrupt')
    expect(parseDraft(JSON.stringify({ ...sampleDraft(), deckId: '1' }), 1).notice).toBe('deck')
  })

  it('accepts base revision 0', () => {
    const raw = JSON.stringify({ ...sampleDraft(), baseRevision: 0 })
    expect(parseDraft(raw, 1).draft?.baseRevision).toBe(0)
  })

  it('clearDraft removes the key', () => {
    const storage = memoryStorage()
    saveDraft(storage, sampleDraft())
    expect(clearDraft(storage)).toBe(true)
    expect(storage.data.has(DRAFT_KEY)).toBe(false)
  })
})
