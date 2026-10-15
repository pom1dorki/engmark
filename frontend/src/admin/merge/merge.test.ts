import { describe, expect, it } from 'vitest'
import { draftReducer, emptyDraft, type Draft, type DraftItem } from '../draft/draft'
import { makeCard, makeChange, makeServerCard } from '../testkit'
import { type CardData, type Changes, type ServerChange, pickCard } from '../types'
import { applyChoices, choiceKey, mergeDraft, mergeFields } from './merge'

function changesOf(items: ServerChange[], revision = 43): Changes {
  return { revision, since: 42, items }
}

function draftOf(items: Record<string, DraftItem>, baseRevision = 42): Draft {
  return { ...emptyDraft(1, baseRevision), items }
}

describe('mergeFields: three-way merge of one card', () => {
  interface Row {
    name: string
    base: Partial<CardData>
    mine: Partial<CardData>
    theirs: Partial<CardData>
    merged: Partial<CardData>
    auto: string[]
    conflicts: string[]
  }
  const rows: Row[] = [
    { name: 'nobody changed anything', base: {}, mine: {}, theirs: {}, merged: {}, auto: [], conflicts: [] },
    { name: 'only I changed a field: keep mine', base: {}, mine: { translation: 'моё' }, theirs: {}, merged: { translation: 'моё' }, auto: [], conflicts: [] },
    { name: 'only the server changed a field: take theirs automatically', base: {}, mine: {}, theirs: { translation: 'их' }, merged: { translation: 'их' }, auto: ['translation'], conflicts: [] },
    { name: 'both made the same change: no conflict', base: {}, mine: { translation: 'так' }, theirs: { translation: 'так' }, merged: { translation: 'так' }, auto: [], conflicts: [] },
    { name: 'both changed the same field differently: conflict, mine stays until chosen', base: {}, mine: { translation: 'моё' }, theirs: { translation: 'их' }, merged: { translation: 'моё' }, auto: [], conflicts: ['translation'] },
    {
      name: 'different fields merge without a dialog',
      base: {},
      mine: { translation: 'моё' },
      theirs: { example: 'Another example with When.' },
      merged: { translation: 'моё', example: 'Another example with When.' },
      auto: ['example'],
      conflicts: [],
    },
    {
      name: 'a conflict in one field does not block auto-merge of another',
      base: {},
      mine: { translation: 'моё', usage: 'моя заметка' },
      theirs: { translation: 'их', example: 'Another example with When.' },
      merged: { translation: 'моё', usage: 'моя заметка', example: 'Another example with When.' },
      auto: ['example'],
      conflicts: ['translation'],
    },
    { name: 'empty base: both fill the field differently', base: { usage: '' }, mine: { usage: 'a' }, theirs: { usage: 'b' }, merged: { usage: 'a' }, auto: [], conflicts: ['usage'] },
    { name: 'server cleared a field I did not touch', base: { usage: 'было' }, mine: { usage: 'было' }, theirs: { usage: '' }, merged: { usage: '' }, auto: ['usage'], conflicts: [] },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = mergeFields(makeCard(row.base), makeCard({ ...row.base, ...row.mine }), makeCard({ ...row.base, ...row.theirs }))
      expect(result.merged).toEqual(makeCard({ ...row.base, ...row.merged }))
      expect(result.auto).toEqual(row.auto)
      expect(result.conflicts.map((c) => c.field)).toEqual(row.conflicts)
    })
  }

  it('describes a conflicting field with all three values', () => {
    const { conflicts } = mergeFields(makeCard(), makeCard({ translation: 'моё' }), makeCard({ translation: 'их' }))
    expect(conflicts).toEqual([{ field: 'translation', base: 'когда', mine: 'моё', theirs: 'их' }])
  })
})

describe('mergeDraft', () => {
  const base = makeCard()

  it('moves the draft to the new revision when the server touched nothing of ours', () => {
    const draft = draftOf({
      '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) },
      'tmp-1': { kind: 'create', card: makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' }) },
    })
    const other = makeServerCard(500, 4, { word: 'elsewhere' })
    const result = mergeDraft(draft, changesOf([makeChange(other, { word: 'elsewhere' })], 44))
    expect(result.conflicts).toEqual([])
    expect(result.autoMerged).toEqual([])
    expect(result.rebasedDraft.baseRevision).toBe(44)
    expect(result.rebasedDraft.items).toEqual(draft.items)
  })

  it('does not mutate the draft it was given', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) } })
    const snapshot = JSON.stringify(draft)
    mergeDraft(draft, changesOf([makeChange(makeServerCard(102, 3, { translation: 'их' }), {})]))
    expect(JSON.stringify(draft)).toBe(snapshot)
  })

  it('pulls in fields changed only on the server and rebases the card', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) } })
    const server = makeServerCard(102, 3, { example: 'New example with When.' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([])
    expect(result.autoMerged).toEqual([{ key: '102', id: 102, word: 'when', serverVersion: 3, fields: ['example'] }])
    expect(result.rebasedDraft.items['102']).toEqual({
      kind: 'update',
      baseVersion: 3,
      base: pickCard(server),
      card: makeCard({ translation: 'моё', example: 'New example with When.' }),
    })
  })

  it('reports only the fields both sides changed', () => {
    const draft = draftOf({
      '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё', usage: 'моя заметка' }) },
    })
    const server = makeServerCard(102, 3, { translation: 'их', example: 'New example with When.' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toHaveLength(1)
    const conflict = result.conflicts[0]
    expect(conflict.kind).toBe('fields')
    if (conflict.kind === 'fields') {
      expect(conflict.fields).toEqual([{ field: 'translation', base: 'когда', mine: 'моё', theirs: 'их' }])
      expect(conflict.baseVersion).toBe(2)
      expect(conflict.serverVersion).toBe(3)
    }
    expect(result.autoMerged[0].fields).toEqual(['example'])
    const item = result.rebasedDraft.items['102']
    expect(item.kind).toBe('update')
    if (item.kind === 'update') {
      expect(item.baseVersion).toBe(3)
      expect(item.card.translation).toBe('моё')
      expect(item.card.usage).toBe('моя заметка')
      expect(item.card.example).toBe('New example with When.')
    }
  })

  it('drops an edit that the server already made', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'так' }) } })
    const result = mergeDraft(draft, changesOf([makeChange(makeServerCard(102, 3, { translation: 'так' }), {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items).toEqual({})
  })

  it('keeps an item as is when it already starts from the current server version', () => {
    const item: DraftItem = { kind: 'update', baseVersion: 3, base, card: makeCard({ translation: 'моё' }) }
    const result = mergeDraft(draftOf({ '102': item }), changesOf([makeChange(makeServerCard(102, 3), {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items['102']).toEqual(item)
  })

  it('card level: I edit, the server archived the card', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) } })
    const server = makeServerCard(102, 3, { archived: true, archivedAt: '2026-10-02T10:00:00Z' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([{ kind: 'archived_on_server', key: '102', id: 102, word: 'when', serverVersion: 3 }])
    expect(result.rebasedDraft.items['102']).toEqual({
      kind: 'update',
      baseVersion: 3,
      base: pickCard(server),
      card: makeCard({ translation: 'моё' }),
    })
  })

  it('card level: I archive, the server edited the card', () => {
    const draft = draftOf({ '102': { kind: 'archive', baseVersion: 2, base } })
    const server = makeServerCard(102, 3, { translation: 'их' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([{ kind: 'changed_on_server', key: '102', id: 102, word: 'when', serverVersion: 3 }])
    expect(result.rebasedDraft.items['102']).toEqual({ kind: 'archive', baseVersion: 3, base: pickCard(server) })
  })

  it('I archive, the server archived it too: nothing left to do', () => {
    const draft = draftOf({ '102': { kind: 'archive', baseVersion: 2, base } })
    const server = makeServerCard(102, 3, { archived: true, archivedAt: '2026-10-02T10:00:00Z' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items).toEqual({})
  })

  it('my new card duplicates a card the server created', () => {
    const mine = makeCard({ word: 'Luggage', pos: 'noun', translation: 'багаж' })
    const draft = draftOf({ 'tmp-1': { kind: 'create', card: mine } })
    const server = makeServerCard(900, 1, { word: 'luggage', pos: 'noun', translation: 'багаж' })
    const result = mergeDraft(draft, changesOf([makeChange(server, null)]))
    expect(result.conflicts).toEqual([{ kind: 'duplicate_create', key: 'tmp-1', word: 'Luggage', serverId: 900 }])
    expect(result.rebasedDraft.items['tmp-1']).toEqual({ kind: 'create', card: mine })
  })

  it('an archived server card with the same key is not a duplicate', () => {
    const mine = makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' })
    const draft = draftOf({ 'tmp-1': { kind: 'create', card: mine } })
    const server = makeServerCard(900, 2, { word: 'luggage', pos: 'noun', translation: 'багаж', archived: true, archivedAt: '2026-10-02T10:00:00Z' })
    const result = mergeDraft(draft, changesOf([makeChange(server, { word: 'luggage', pos: 'noun', translation: 'багаж' })]))
    expect(result.conflicts).toEqual([])
  })

  it('restore: the card is still archived, only the base moves', () => {
    const draft = draftOf({ '87': { kind: 'restore', baseVersion: 3, base } })
    const server = makeServerCard(87, 4, { archived: true, archivedAt: '2026-10-02T10:00:00Z', usage: 'заметка' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items['87']).toEqual({ kind: 'restore', baseVersion: 4, base: pickCard(server) })
  })

  it('restore with edits: someone already restored the card, my edits become a plain update', () => {
    const draft = draftOf({ '87': { kind: 'restore', baseVersion: 3, base, card: makeCard({ translation: 'моё' }) } })
    const server = makeServerCard(87, 4, { example: 'New example with When.' })
    const result = mergeDraft(draft, changesOf([makeChange(server, {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items['87']).toEqual({
      kind: 'update',
      baseVersion: 4,
      base: pickCard(server),
      card: makeCard({ translation: 'моё', example: 'New example with When.' }),
    })
  })

  it('restore without edits: someone already restored the card, nothing left to do', () => {
    const draft = draftOf({ '87': { kind: 'restore', baseVersion: 3, base } })
    const result = mergeDraft(draft, changesOf([makeChange(makeServerCard(87, 4), {})]))
    expect(result.conflicts).toEqual([])
    expect(result.rebasedDraft.items).toEqual({})
  })

  it('imports and the message ride along', () => {
    let draft = draftOf({})
    draft = draftReducer(draft, { type: 'addImport', file: { fileName: 'a.json', cards: [makeCard({ word: 'x' })], preview: { added: 1, skipped: 0, errors: 0 } } })
    draft = draftReducer(draft, { type: 'setMessage', message: 'Откат к r40' })
    const result = mergeDraft(draft, changesOf([], 45))
    expect(result.rebasedDraft.baseRevision).toBe(45)
    expect(result.rebasedDraft.imports).toHaveLength(1)
    expect(result.rebasedDraft.message).toBe('Откат к r40')
  })
})

describe('applyChoices', () => {
  const base = makeCard()

  function conflictedField() {
    const draft = draftOf({
      '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё', usage: 'моя заметка' }) },
    })
    const server = makeServerCard(102, 3, { translation: 'их' })
    return mergeDraft(draft, changesOf([makeChange(server, {})]))
  }

  it('keeps my value when nothing is chosen or "mine" is chosen', () => {
    const { rebasedDraft, conflicts } = conflictedField()
    for (const choices of [{}, { [choiceKey('102', 'translation')]: 'mine' }]) {
      const item = applyChoices(rebasedDraft, conflicts, choices).items['102']
      expect(item.kind === 'update' && item.card.translation).toBe('моё')
    }
  })

  it('takes the server value for a field when "theirs" is chosen, the rest of my edit stays', () => {
    const { rebasedDraft, conflicts } = conflictedField()
    const item = applyChoices(rebasedDraft, conflicts, { [choiceKey('102', 'translation')]: 'theirs' }).items['102']
    expect(item.kind).toBe('update')
    if (item.kind === 'update') {
      expect(item.card.translation).toBe('их')
      expect(item.card.usage).toBe('моя заметка')
    }
  })

  it('removes the item when choosing the server value leaves nothing to save', () => {
    const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) } })
    const { rebasedDraft, conflicts } = mergeDraft(draft, changesOf([makeChange(makeServerCard(102, 3, { translation: 'их' }), {})]))
    const result = applyChoices(rebasedDraft, conflicts, { [choiceKey('102', 'translation')]: 'theirs' })
    expect(result.items).toEqual({})
  })

  it('does not change the rebased draft it was given', () => {
    const { rebasedDraft, conflicts } = conflictedField()
    const snapshot = JSON.stringify(rebasedDraft)
    applyChoices(rebasedDraft, conflicts, { [choiceKey('102', 'translation')]: 'theirs' })
    expect(JSON.stringify(rebasedDraft)).toBe(snapshot)
  })

  describe('card level conflicts', () => {
    const archivedOnServer = () => {
      const draft = draftOf({ '102': { kind: 'update', baseVersion: 2, base, card: makeCard({ translation: 'моё' }) } })
      const server = makeServerCard(102, 3, { archived: true, archivedAt: '2026-10-02T10:00:00Z' })
      return mergeDraft(draft, changesOf([makeChange(server, {})]))
    }

    it('archived on the server: restore with my edits by default', () => {
      const { rebasedDraft, conflicts } = archivedOnServer()
      const item = applyChoices(rebasedDraft, conflicts, {}).items['102']
      expect(item.kind).toBe('restore')
      if (item.kind === 'restore') {
        expect(item.baseVersion).toBe(3)
        expect(item.card?.translation).toBe('моё')
      }
    })

    it('archived on the server: drop my edit', () => {
      const { rebasedDraft, conflicts } = archivedOnServer()
      expect(applyChoices(rebasedDraft, conflicts, { [choiceKey('102')]: 'drop' }).items).toEqual({})
    })

    it('changed on the server: archive anyway by default, or drop', () => {
      const draft = draftOf({ '102': { kind: 'archive', baseVersion: 2, base } })
      const { rebasedDraft, conflicts } = mergeDraft(draft, changesOf([makeChange(makeServerCard(102, 3, { translation: 'их' }), {})]))
      expect(applyChoices(rebasedDraft, conflicts, {}).items['102'].kind).toBe('archive')
      expect(applyChoices(rebasedDraft, conflicts, { [choiceKey('102')]: 'drop' }).items).toEqual({})
    })

    it('duplicate create: keep by default, or drop', () => {
      const mine = makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' })
      const draft = draftOf({ 'tmp-1': { kind: 'create', card: mine } })
      const server = makeServerCard(900, 1, { word: 'luggage', pos: 'noun', translation: 'багаж' })
      const { rebasedDraft, conflicts } = mergeDraft(draft, changesOf([makeChange(server, null)]))
      expect(applyChoices(rebasedDraft, conflicts, {}).items['tmp-1']).toEqual({ kind: 'create', card: mine })
      expect(applyChoices(rebasedDraft, conflicts, { [choiceKey('tmp-1')]: 'drop' }).items).toEqual({})
    })
  })
})

describe('choiceKey', () => {
  it('addresses a field or a whole card', () => {
    expect(choiceKey('102', 'translation')).toBe('102:translation')
    expect(choiceKey('102')).toBe('102')
  })
})
