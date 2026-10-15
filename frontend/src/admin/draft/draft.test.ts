import { describe, expect, it } from 'vitest'
import { makeCard } from '../testkit'
import {
  draftCounts,
  draftReducer,
  emptyDraft,
  importedCount,
  isDraftEmpty,
  nextCreateKey,
  type Draft,
  type DraftImport,
} from './draft'

const base = makeCard()
const edited = makeCard({ translation: 'когда, в то время как' })

function file(name: string, n: number): DraftImport {
  return {
    fileName: name,
    cards: Array.from({ length: n }, (_, i) => makeCard({ word: `w${i}` })),
    preview: { added: n, skipped: 0, errors: 0 },
  }
}

describe('draftReducer', () => {
  it('starts empty', () => {
    const draft = emptyDraft(1, 42)
    expect(isDraftEmpty(draft)).toBe(true)
    expect(draft.schema).toBe(1)
    expect(draft.baseRevision).toBe(42)
  })

  it('adds new cards under tmp keys', () => {
    let draft = emptyDraft(1, 42)
    expect(nextCreateKey(draft)).toBe('tmp-1')
    draft = draftReducer(draft, { type: 'upsertCreate', key: 'tmp-1', card: base })
    draft = draftReducer(draft, { type: 'upsertCreate', key: nextCreateKey(draft), card: edited })
    expect(Object.keys(draft.items)).toEqual(['tmp-1', 'tmp-2'])
    expect(nextCreateKey(draft)).toBe('tmp-3')
    draft = draftReducer(draft, { type: 'discardItem', key: 'tmp-1' })
    expect(nextCreateKey(draft)).toBe('tmp-3')
  })

  it('records the base of an update', () => {
    const draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 102, baseVersion: 2, base, card: edited })
    expect(draft.items['102']).toEqual({ kind: 'update', baseVersion: 2, base, card: edited })
  })

  it('keeps the original base when the card is edited again', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 102, baseVersion: 2, base, card: edited })
    const newer = makeCard({ translation: 'другое' })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 102, baseVersion: 3, base: newer, card: makeCard({ translation: 'ещё' }) })
    const item = draft.items['102']
    expect(item.kind).toBe('update')
    if (item.kind === 'update') {
      expect(item.baseVersion).toBe(2)
      expect(item.base).toEqual(base)
      expect(item.card.translation).toBe('ещё')
    }
  })

  it('drops an update that returns the card to its base', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 102, baseVersion: 2, base, card: edited })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 102, baseVersion: 2, base, card: { ...base } })
    expect(isDraftEmpty(draft)).toBe(true)
  })

  it('archives with the base of the pending edit', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 102, baseVersion: 2, base, card: edited })
    draft = draftReducer(draft, { type: 'archive', id: 102, baseVersion: 5, base: makeCard({ word: 'x' }) })
    expect(draft.items['102']).toEqual({ kind: 'archive', baseVersion: 2, base })
  })

  it('an edit cancels a pending archive', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'archive', id: 104, baseVersion: 1, base })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 104, baseVersion: 1, base, card: edited })
    expect(draft.items['104'].kind).toBe('update')
  })

  it('restores, and edits made after restore ride along with it', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'restore', id: 87, baseVersion: 3, base })
    expect(draft.items['87']).toEqual({ kind: 'restore', baseVersion: 3, base })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 87, baseVersion: 3, base, card: edited })
    expect(draft.items['87']).toEqual({ kind: 'restore', baseVersion: 3, base, card: edited })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 87, baseVersion: 3, base, card: { ...base } })
    expect(draft.items['87']).toEqual({ kind: 'restore', baseVersion: 3, base })
  })

  it('manages imports', () => {
    let draft = emptyDraft(1, 42)
    draft = draftReducer(draft, { type: 'addImport', file: file('a.json', 3) })
    draft = draftReducer(draft, { type: 'addImport', file: file('b.json', 2) })
    expect(importedCount(draft)).toBe(5)
    expect(isDraftEmpty(draft)).toBe(false)
    draft = draftReducer(draft, { type: 'removeImport', index: 0 })
    expect(draft.imports.map((f) => f.fileName)).toEqual(['b.json'])
  })

  it('counts items by kind', () => {
    let draft: Draft = emptyDraft(1, 42)
    draft = draftReducer(draft, { type: 'upsertCreate', key: 'tmp-1', card: base })
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 1, baseVersion: 1, base, card: edited })
    draft = draftReducer(draft, { type: 'archive', id: 2, baseVersion: 1, base })
    draft = draftReducer(draft, { type: 'restore', id: 3, baseVersion: 1, base })
    draft = draftReducer(draft, { type: 'addImport', file: file('a.json', 4) })
    expect(draftCounts(draft)).toEqual({ created: 1, updated: 1, archived: 1, restored: 1, imported: 4 })
  })

  it('discardAll keeps the deck and the base revision', () => {
    let draft = draftReducer(emptyDraft(7, 42), { type: 'upsertCreate', key: 'tmp-1', card: base })
    draft = draftReducer(draft, { type: 'setMessage', message: 'Откат к r40' })
    draft = draftReducer(draft, { type: 'discardAll' })
    expect(draft).toEqual(emptyDraft(7, 42))
  })

  it('rebase replaces the items and the revision, imports stay', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertCreate', key: 'tmp-1', card: base })
    draft = draftReducer(draft, { type: 'addImport', file: file('a.json', 1) })
    draft = draftReducer(draft, { type: 'rebase', baseRevision: 43, items: {} })
    expect(draft.baseRevision).toBe(43)
    expect(Object.keys(draft.items)).toEqual([])
    expect(draft.imports).toHaveLength(1)
  })

  it('does not mutate the previous state', () => {
    const before = emptyDraft(1, 42)
    const snapshot = JSON.stringify(before)
    draftReducer(before, { type: 'upsertCreate', key: 'tmp-1', card: base })
    draftReducer(before, { type: 'addImport', file: file('a.json', 1) })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('discarding an unknown item returns the same state', () => {
    const draft = draftReducer(emptyDraft(1, 42), { type: 'upsertCreate', key: 'tmp-1', card: base })
    expect(draftReducer(draft, { type: 'discardItem', key: '999' })).toBe(draft)
    expect(Object.keys(draftReducer(draft, { type: 'discardItem', key: 'tmp-1' }).items)).toEqual([])
  })

  it('replace swaps the whole draft', () => {
    const other = draftReducer(emptyDraft(1, 50), { type: 'archive', id: 5, baseVersion: 1, base })
    expect(draftReducer(emptyDraft(1, 42), { type: 'replace', draft: other })).toBe(other)
  })

  it('setMessage sets and clears the message', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'setMessage', message: 'Откат к r40' })
    expect(draft.message).toBe('Откат к r40')
    draft = draftReducer(draft, { type: 'setMessage', message: undefined })
    expect(draft.message).toBeUndefined()
  })

  it('the label goes away with the last item, so the next edit does not inherit it', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 7, baseVersion: 2, base, card: edited })
    draft = draftReducer(draft, { type: 'upsertCreate', key: 'tmp-1', card: base })
    draft = draftReducer(draft, { type: 'setMessage', message: 'Откат к r40' })
    draft = draftReducer(draft, { type: 'discardItem', key: 'tmp-1' })
    expect(draft.message).toBe('Откат к r40')
    draft = draftReducer(draft, { type: 'upsertUpdate', id: 7, baseVersion: 2, base, card: base })
    expect(isDraftEmpty(draft)).toBe(true)
    expect(draft.message).toBeUndefined()

    let withFile = draftReducer(emptyDraft(1, 42), { type: 'addImport', file: file('a.json', 2) })
    withFile = draftReducer(withFile, { type: 'setMessage', message: 'Откат к r40' })
    withFile = draftReducer(withFile, { type: 'removeImport', index: 0 })
    expect(withFile.message).toBeUndefined()
  })

  it('an update over a new-card key keeps the action base', () => {
    const draft = draftReducer(emptyDraft(1, 42), { type: 'upsertCreate', key: 'tmp-1', card: base })
    const next = draftReducer(draft, { type: 'upsertUpdate', id: 7, baseVersion: 4, base, card: edited })
    expect(next.items['7']).toEqual({ kind: 'update', baseVersion: 4, base, card: edited })
    expect(next.items['tmp-1']).toEqual({ kind: 'create', card: base })
  })

  it('restore over a pending update replaces it', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertUpdate', id: 9, baseVersion: 2, base, card: edited })
    draft = draftReducer(draft, { type: 'restore', id: 9, baseVersion: 2, base })
    expect(draft.items['9']).toEqual({ kind: 'restore', baseVersion: 2, base })
  })
})
