import { describe, expect, it } from 'vitest'
import { draftFromChangeset, toChangeset } from './changeset'
import { type Draft, type DraftItem, emptyDraft } from './draft/draft'
import { makeCard } from './testkit'
import type { CardData, ChangesetBody } from './types'

const base = makeCard()
const edited = makeCard({ translation: 'когда, в то время как' })

function draftOf(items: Record<string, DraftItem>, extra: Partial<Draft> = {}): Draft {
  return { ...emptyDraft(1, 42), items, ...extra }
}

describe('toChangeset', () => {
  it('builds every section from a mixed draft', () => {
    const draft = draftOf(
      {
        'tmp-1': { kind: 'create', card: makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' }) },
        '102': { kind: 'update', baseVersion: 2, base, card: edited },
        '104': { kind: 'archive', baseVersion: 1, base },
        '87': { kind: 'restore', baseVersion: 3, base },
      },
      { imports: [{ fileName: 'travel.json', cards: [makeCard({ word: 'delay', pos: 'noun', translation: 'задержка' })], preview: { added: 1, skipped: 0, errors: 0 } }] },
    )
    const { body, createKeys } = toChangeset(draft, 'Правки примеров')
    expect(body).toEqual({
      baseRevision: 42,
      message: 'Правки примеров',
      create: [makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' })],
      update: [{ id: 102, baseVersion: 2, card: edited }],
      archive: [{ id: 104, baseVersion: 1 }],
      restore: [{ id: 87, baseVersion: 3 }],
      imports: [{ fileName: 'travel.json', cards: [makeCard({ word: 'delay', pos: 'noun', translation: 'задержка' })] }],
    })
    expect(createKeys).toEqual(['tmp-1'])
  })

  it('always sends every section so the server sees a complete body', () => {
    const { body } = toChangeset(draftOf({}))
    expect(body).toEqual({ baseRevision: 42, create: [], update: [], archive: [], restore: [], imports: [] })
    expect('message' in body).toBe(false)
  })

  it('orders new cards by their number and the rest by id', () => {
    const draft = draftOf({
      'tmp-10': { kind: 'create', card: makeCard({ word: 'ten' }) },
      'tmp-2': { kind: 'create', card: makeCard({ word: 'two' }) },
      '300': { kind: 'archive', baseVersion: 1, base },
      '25': { kind: 'archive', baseVersion: 1, base },
    })
    const { body, createKeys } = toChangeset(draft)
    expect(createKeys).toEqual(['tmp-2', 'tmp-10'])
    expect(body.create.map((c) => c.word)).toEqual(['two', 'ten'])
    expect(body.archive.map((r) => r.id)).toEqual([25, 300])
  })

  it('remembers which draft element stands behind every element of the body', () => {
    const draft = draftOf(
      {
        'tmp-2': { kind: 'create', card: makeCard({ word: 'two' }) },
        'tmp-1': { kind: 'create', card: makeCard({ word: 'one' }) },
        '300': { kind: 'update', baseVersion: 1, base, card: edited },
        '87': { kind: 'restore', baseVersion: 3, base, card: edited },
        '25': { kind: 'archive', baseVersion: 1, base },
        '26': { kind: 'restore', baseVersion: 2, base },
      },
      {
        imports: [
          { fileName: 'empty.json', cards: [], preview: { added: 0, skipped: 0, errors: 0 } },
          { fileName: 'travel.json', cards: [makeCard({ word: 'delay' })], preview: { added: 1, skipped: 0, errors: 0 } },
        ],
      },
    )
    const built = toChangeset(draft)
    expect(built.createKeys).toEqual(['tmp-1', 'tmp-2'])
    expect(built.updateKeys).toEqual(['87', '300'])
    expect(built.body.update.map((u) => u.id)).toEqual([87, 300])
    expect(built.archiveKeys).toEqual(['25'])
    expect(built.restoreKeys).toEqual(['26', '87'])
    expect(built.body.restore.map((r) => r.id)).toEqual([26, 87])
    expect(built.body.imports.map((f) => f.fileName)).toEqual(['travel.json'])
    expect(built.importIndexes).toEqual([1])
  })

  it('restore with edits goes out as a restore plus an update with the same baseVersion', () => {
    const { body } = toChangeset(draftOf({ '87': { kind: 'restore', baseVersion: 3, base, card: edited } }))
    expect(body.restore).toEqual([{ id: 87, baseVersion: 3 }])
    expect(body.update).toEqual([{ id: 87, baseVersion: 3, card: edited }])
  })

  it('trims text before sending: the server compares trimmed values', () => {
    const { body } = toChangeset(
      draftOf({ 'tmp-1': { kind: 'create', card: makeCard({ word: '  luggage ', translation: ' багаж ' }) } }),
    )
    expect(body.create[0].word).toBe('luggage')
    expect(body.create[0].translation).toBe('багаж')
  })

  it('uses the draft message unless one is passed, and omits a blank one', () => {
    expect(toChangeset(draftOf({}, { message: 'Откат к r40' })).body.message).toBe('Откат к r40')
    expect(toChangeset(draftOf({}, { message: 'Откат к r40' }), 'Своё').body.message).toBe('Своё')
    expect('message' in toChangeset(draftOf({}), '   ').body).toBe(false)
  })

  it('skips import files without cards', () => {
    const draft = draftOf({}, { imports: [{ fileName: 'empty.json', cards: [], preview: { added: 0, skipped: 0, errors: 0 } }] })
    expect(toChangeset(draft).body.imports).toEqual([])
  })

  it('does not change the draft', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ word: ' when ' }) } })
    const snapshot = JSON.stringify(draft)
    toChangeset(draft)
    expect(JSON.stringify(draft)).toBe(snapshot)
  })
})

describe('draftFromChangeset', () => {
  const bases: Record<number, CardData> = { 102: base, 104: base, 87: base }

  it('turns a revert changeset into a draft with a message', () => {
    const body: ChangesetBody = {
      baseRevision: 45,
      message: 'Откат к r40',
      create: [makeCard({ word: 'luggage' })],
      update: [{ id: 102, baseVersion: 4, card: edited }],
      archive: [{ id: 104, baseVersion: 2 }],
      restore: [{ id: 87, baseVersion: 3 }],
      imports: [],
    }
    const draft = draftFromChangeset(body, 1, bases)
    expect(draft.baseRevision).toBe(45)
    expect(draft.deckId).toBe(1)
    expect(draft.message).toBe('Откат к r40')
    expect(draft.items).toEqual({
      'tmp-1': { kind: 'create', card: makeCard({ word: 'luggage' }) },
      '102': { kind: 'update', baseVersion: 4, base, card: edited },
      '104': { kind: 'archive', baseVersion: 2, base },
      '87': { kind: 'restore', baseVersion: 3, base },
    })
  })

  it('folds an update + restore pair back into one restore with edits', () => {
    const body: ChangesetBody = {
      baseRevision: 45,
      create: [],
      update: [{ id: 87, baseVersion: 3, card: edited }],
      archive: [],
      restore: [{ id: 87, baseVersion: 3 }],
      imports: [],
    }
    expect(draftFromChangeset(body, 1, bases).items['87']).toEqual({ kind: 'restore', baseVersion: 3, base, card: edited })
  })

  it('fails loudly when a base state is missing', () => {
    const body: ChangesetBody = { baseRevision: 45, create: [], update: [{ id: 999, baseVersion: 1, card: edited }], archive: [], restore: [], imports: [] }
    expect(() => draftFromChangeset(body, 1, bases)).toThrow('999')
  })

  it('round-trips through toChangeset', () => {
    const draft = draftOf(
      {
        'tmp-1': { kind: 'create', card: makeCard({ word: 'luggage' }) },
        'tmp-2': { kind: 'create', card: makeCard({ word: 'delay' }) },
        '102': { kind: 'update', baseVersion: 2, base, card: edited },
        '104': { kind: 'archive', baseVersion: 1, base },
        '87': { kind: 'restore', baseVersion: 3, base, card: edited },
      },
      { message: 'Откат к r40' },
    )
    const { body } = toChangeset(draft)
    expect(draftFromChangeset(body, 1, { 102: base, 104: base, 87: base })).toEqual(draft)
  })
})
