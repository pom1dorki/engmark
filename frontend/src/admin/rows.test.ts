import { describe, expect, it } from 'vitest'
import { type Draft, type DraftImport, emptyDraft } from './draft/draft'
import { type ListFilters, buildRows, filledCount, findDuplicate, importGroups, serverQuery, versionText } from './rows'
import { makeCard, makeServerCard } from './testkit'

const ACTIVE: ListFilters = { q: '', pos: '', state: 'active' }

function draftWith(items: Draft['items']): Draft {
  return { ...emptyDraft(1, 42), items }
}

function words(rows: { card: { word: string } }[]): string[] {
  return rows.map((row) => row.card.word)
}

describe('filledCount', () => {
  it('counts non-empty fields out of eleven', () => {
    expect(filledCount(makeCard())).toBe(6)
    expect(filledCount(makeCard({ ipa: '/x/', pronunciation: '[x]', stressNote: 's', grammar: 'g', usage: 'u' }))).toBe(11)
  })

  it('does not count blanks', () => {
    expect(filledCount(makeCard({ example: '   ', exampleHighlight: '', exampleTranslation: '' }))).toBe(3)
  })
})

describe('serverQuery', () => {
  it('maps state, search and part of speech', () => {
    expect(serverQuery({ q: '  luggage ', pos: 'noun', state: 'active' })).toEqual({ state: 'active', q: 'luggage', pos: 'noun' })
    expect(serverQuery({ q: '', pos: '', state: 'archived' })).toEqual({ state: 'archived' })
    expect(serverQuery({ q: '', pos: '', state: 'incomplete' })).toEqual({ state: 'incomplete' })
  })

  it('needs no server request for the draft filter', () => {
    expect(serverQuery({ q: 'a', pos: '', state: 'draft' })).toBeNull()
  })
})

describe('buildRows: overlay of the draft on server cards', () => {
  const server = [
    makeServerCard(1, 2, { word: 'alpha', translation: 'альфа' }),
    makeServerCard(2, 1, { word: 'beta', translation: 'бета' }),
    makeServerCard(3, 3, { word: 'gamma', translation: 'гамма' }),
  ]

  it('shows plain server cards as published with their version', () => {
    const rows = buildRows(server, emptyDraft(1, 42), ACTIVE)
    expect(words(rows)).toEqual(['alpha', 'beta', 'gamma'])
    expect(rows.map((r) => r.state)).toEqual(['published', 'published', 'published'])
    expect(versionText(rows[0])).toBe('v2')
  })

  it('shows the edited values and «v2 → v3» for a changed card', () => {
    const base = makeCard({ word: 'alpha', translation: 'альфа' })
    const draft = draftWith({ '1': { kind: 'update', baseVersion: 2, base, card: { ...base, translation: 'альфа и омега' } } })
    const row = buildRows(server, draft, ACTIVE)[0]
    expect(row.state).toBe('changed')
    expect(row.card.translation).toBe('альфа и омега')
    expect(versionText(row)).toBe('v2 → v3')
  })

  it('keeps an archived-in-draft card in the active view with its own tag', () => {
    const base = makeCard({ word: 'beta', translation: 'бета' })
    const draft = draftWith({ '2': { kind: 'archive', baseVersion: 1, base } })
    const active = buildRows(server, draft, ACTIVE)
    expect(active.find((r) => r.id === 2)?.state).toBe('archiving')
    expect(buildRows(server, draft, { ...ACTIVE, state: 'archived' })).toHaveLength(0)
  })

  it('puts new cards on top, the newest first', () => {
    const draft = draftWith({
      'tmp-1': { kind: 'create', card: makeCard({ word: 'first' }) },
      'tmp-2': { kind: 'create', card: makeCard({ word: 'second' }) },
    })
    const rows = buildRows(server, draft, ACTIVE)
    expect(words(rows)).toEqual(['second', 'first', 'alpha', 'beta', 'gamma'])
    expect(rows[0].state).toBe('new')
    expect(rows[0].id).toBeNull()
    expect(versionText(rows[0])).toBe('—')
  })

  it('shows a card returning from the archive in the active view even though the server list lacks it', () => {
    const base = makeCard({ word: 'omega', translation: 'омега' })
    const draft = draftWith({ '9': { kind: 'restore', baseVersion: 4, base } })
    const rows = buildRows(server, draft, ACTIVE)
    expect(rows[0].state).toBe('restoring')
    expect(versionText(rows[0])).toBe('v4 → v5')
  })

  it('takes edits made while restoring', () => {
    const base = makeCard({ word: 'omega', translation: 'омега' })
    const draft = draftWith({ '9': { kind: 'restore', baseVersion: 4, base, card: { ...base, translation: 'омега 2' } } })
    expect(buildRows(server, draft, ACTIVE)[0].card.translation).toBe('омега 2')
  })

  it('moves a restored card out of the archive list but keeps others there', () => {
    const archived = [makeServerCard(7, 2, { word: 'zeta', archived: true }), makeServerCard(8, 1, { word: 'eta', archived: true })]
    const base = makeCard({ word: 'zeta' })
    const draft = draftWith({ '7': { kind: 'restore', baseVersion: 2, base } })
    const rows = buildRows(archived, draft, { ...ACTIVE, state: 'archived' })
    expect(words(rows)).toEqual(['eta'])
    expect(rows[0].state).toBe('archived')
  })

  it('ignores the server list for the draft filter and shows every draft item', () => {
    const baseAlpha = makeCard({ word: 'alpha' })
    const draft = draftWith({
      '1': { kind: 'update', baseVersion: 2, base: baseAlpha, card: { ...baseAlpha, translation: 'x' } },
      '2': { kind: 'archive', baseVersion: 1, base: makeCard({ word: 'beta' }) },
      'tmp-1': { kind: 'create', card: makeCard({ word: 'new' }) },
    })
    const rows = buildRows(server, draft, { ...ACTIVE, state: 'draft' })
    expect(rows.map((r) => r.state).sort()).toEqual(['archiving', 'changed', 'new'])
  })

  it('applies search and part of speech to the overlaid values', () => {
    const base = makeCard({ word: 'alpha', translation: 'альфа', pos: 'noun' })
    const draft = draftWith({ '1': { kind: 'update', baseVersion: 2, base, card: { ...base, word: 'delta', pos: 'verb' } } })
    expect(words(buildRows(server, draft, { ...ACTIVE, q: 'DELT' }))).toEqual(['delta'])
    expect(words(buildRows(server, draft, { ...ACTIVE, pos: 'verb' }))).toEqual(['delta'])
    expect(words(buildRows(server, draft, { ...ACTIVE, q: 'alpha' }))).toEqual([])
  })

  it('searches by translation too', () => {
    expect(words(buildRows(server, emptyDraft(1, 42), { ...ACTIVE, q: 'ГАММ' }))).toEqual(['gamma'])
  })

  it('drops a card from the incomplete list once the draft completes it', () => {
    const base = makeCard({ word: 'alpha' })
    const full = { ...base, ipa: 'i', pronunciation: 'p', stressNote: 's', grammar: 'g', usage: 'u' }
    const draft = draftWith({ '1': { kind: 'update', baseVersion: 2, base, card: full } })
    const rows = buildRows([server[0]], draft, { ...ACTIVE, state: 'incomplete' })
    expect(rows).toHaveLength(0)
  })

  it('lists only incomplete new cards in the incomplete view', () => {
    const complete = makeCard({ word: 'full', ipa: 'i', pronunciation: 'p', stressNote: 's', grammar: 'g', usage: 'u' })
    const draft = draftWith({ 'tmp-1': { kind: 'create', card: complete }, 'tmp-2': { kind: 'create', card: makeCard({ word: 'thin' }) } })
    expect(words(buildRows([], draft, { ...ACTIVE, state: 'incomplete' }))).toEqual(['thin'])
  })
})

describe('findDuplicate', () => {
  const server = [makeServerCard(1, 1, { word: 'Luggage', pos: 'noun', translation: 'багаж' })]
  const target = makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' })

  it('finds a duplicate in the deck regardless of case', () => {
    expect(findDuplicate(target, null, emptyDraft(1, 42), server)).toEqual({ where: 'deck', id: 1, word: 'Luggage' })
  })

  it('does not treat another translation or part of speech as a duplicate', () => {
    expect(findDuplicate({ ...target, translation: 'чемодан' }, null, emptyDraft(1, 42), server)).toBeNull()
    expect(findDuplicate({ ...target, pos: 'verb' }, null, emptyDraft(1, 42), server)).toBeNull()
  })

  it('does not compare a card with itself', () => {
    expect(findDuplicate(target, '1', emptyDraft(1, 42), server)).toBeNull()
  })

  it('finds a duplicate among new cards in the draft', () => {
    const draft = draftWith({ 'tmp-3': { kind: 'create', card: target } })
    expect(findDuplicate(target, null, draft, [])).toEqual({ where: 'draft', id: null, word: 'luggage' })
    expect(findDuplicate(target, 'tmp-3', draft, [])).toBeNull()
  })

  it('does not count a card that the draft sends to the archive: the server frees its key first', () => {
    const draft = draftWith({ '1': { kind: 'archive', baseVersion: 1, base: makeCard({ word: 'Luggage', pos: 'noun', translation: 'багаж' }) } })
    expect(findDuplicate(target, null, draft, server)).toBeNull()
  })

  it('uses the edited values of a changed card, not the server ones', () => {
    const base = makeCard({ word: 'Luggage', pos: 'noun', translation: 'багаж' })
    const renamed = draftWith({ '1': { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'вещи' } } })
    expect(findDuplicate(target, null, renamed, server)).toBeNull()
    expect(findDuplicate({ ...target, translation: 'вещи' }, null, renamed, server)).toEqual({ where: 'draft', id: 1, word: 'Luggage' })
  })

  it('counts a card returning from the archive as occupying its key', () => {
    const draft = draftWith({ '5': { kind: 'restore', baseVersion: 2, base: target } })
    expect(findDuplicate(target, null, draft, [])?.where).toBe('draft')
  })
})

describe('importGroups', () => {
  const file = (fileName: string, count: number): DraftImport => ({
    fileName,
    cards: Array.from({ length: count }, (_, i) => makeCard({ word: `w${'abcdefghij'[i]}` })),
    preview: { added: count, skipped: 0, errors: 0 },
  })
  const imports = [file('a.json', 3), file('empty.json', 0), file('b.json', 1)]

  it('lists the files in draft order, with their position in draft.imports', () => {
    expect(importGroups(imports, ACTIVE)).toEqual([
      { index: 0, fileName: 'a.json', count: 3 },
      { index: 2, fileName: 'b.json', count: 1 },
    ])
  })

  it('shows files under «Активные» and «В черновике» only', () => {
    expect(importGroups(imports, { ...ACTIVE, state: 'draft' })).toHaveLength(2)
    expect(importGroups(imports, { ...ACTIVE, state: 'archived' })).toEqual([])
    expect(importGroups(imports, { ...ACTIVE, state: 'incomplete' })).toEqual([])
  })

  it('hides files while searching or filtering by part of speech', () => {
    expect(importGroups(imports, { ...ACTIVE, q: 'a' })).toEqual([])
    expect(importGroups(imports, { ...ACTIVE, q: '   ' })).toHaveLength(2)
    expect(importGroups(imports, { ...ACTIVE, pos: 'noun' })).toEqual([])
  })

  it('has nothing to show without imports', () => {
    expect(importGroups([], ACTIVE)).toEqual([])
  })
})
