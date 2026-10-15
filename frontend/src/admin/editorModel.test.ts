import { describe, expect, it } from 'vitest'
import { emptyDraft } from './draft/draft'
import { needsFetch, resolveEditor, splitHighlight, targetKey } from './editorModel'
import { makeCard, makeServerCard } from './testkit'
import { emptyCard, pickCard } from './types'

const base = makeCard({ word: 'alpha', translation: 'альфа' })

describe('resolveEditor', () => {
  it('opens a new card with an empty form and no base', () => {
    const model = resolveEditor({ kind: 'new' }, emptyDraft(1, 42), null)
    expect(model).toMatchObject({ key: null, id: null, mode: 'edit', base: null, baseVersion: null, inDraft: null })
    expect(model?.initial).toEqual(emptyCard())
  })

  it('opens a new card that already lies in the draft', () => {
    const draft = { ...emptyDraft(1, 42), items: { 'tmp-2': { kind: 'create' as const, card: base } } }
    const model = resolveEditor({ kind: 'create', key: 'tmp-2' }, draft, null)
    expect(model).toMatchObject({ key: 'tmp-2', id: null, inDraft: 'create', base: null })
    expect(model?.initial).toEqual(base)
  })

  it('waits for the server card when the card is not in the draft', () => {
    expect(resolveEditor({ kind: 'card', id: 7 }, emptyDraft(1, 42), null)).toBeNull()
  })

  it('takes the fetched version as baseVersion and the whole card as base', () => {
    const fetched = makeServerCard(7, 3, { word: 'alpha' })
    const model = resolveEditor({ kind: 'card', id: 7 }, emptyDraft(1, 42), fetched)
    expect(model).toMatchObject({ key: '7', id: 7, mode: 'edit', baseVersion: 3, inDraft: null })
    expect(model?.base).toEqual(pickCard(fetched))
    expect(model?.initial).toEqual(pickCard(fetched))
  })

  it('opens an archived server card read-only', () => {
    const fetched = makeServerCard(7, 3, { archived: true })
    expect(resolveEditor({ kind: 'card', id: 7 }, emptyDraft(1, 42), fetched)?.mode).toBe('archived')
  })

  it('does not reread the base of a card that is already in the draft', () => {
    const edited = { ...base, translation: 'правка' }
    const draft = { ...emptyDraft(1, 42), items: { '7': { kind: 'update' as const, baseVersion: 2, base, card: edited } } }
    const model = resolveEditor({ kind: 'card', id: 7 }, draft, makeServerCard(7, 5))
    expect(model).toMatchObject({ baseVersion: 2, inDraft: 'update' })
    expect(model?.base).toEqual(base)
    expect(model?.initial).toEqual(edited)
  })

  it('shows a card that goes to the archive read-only', () => {
    const draft = { ...emptyDraft(1, 42), items: { '7': { kind: 'archive' as const, baseVersion: 2, base } } }
    expect(resolveEditor({ kind: 'card', id: 7 }, draft, null)).toMatchObject({ mode: 'archiving', inDraft: 'archive', baseVersion: 2 })
  })

  it('makes a card returning from the archive editable, starting from its edits', () => {
    const edited = { ...base, translation: 'правка' }
    const draft = { ...emptyDraft(1, 42), items: { '7': { kind: 'restore' as const, baseVersion: 2, base, card: edited } } }
    const model = resolveEditor({ kind: 'card', id: 7 }, draft, null)
    expect(model).toMatchObject({ mode: 'edit', inDraft: 'restore' })
    expect(model?.initial).toEqual(edited)
    expect(model?.base).toEqual(base)
  })
})

describe('needsFetch / targetKey', () => {
  it('reads from the server only cards that are not in the draft', () => {
    const draft = { ...emptyDraft(1, 42), items: { '7': { kind: 'archive' as const, baseVersion: 2, base } } }
    expect(needsFetch({ kind: 'card', id: 7 }, draft)).toBe(false)
    expect(needsFetch({ kind: 'card', id: 8 }, draft)).toBe(true)
    expect(needsFetch({ kind: 'new' }, draft)).toBe(false)
    expect(needsFetch({ kind: 'create', key: 'tmp-1' }, draft)).toBe(false)
  })

  it('names the draft key of a target', () => {
    expect(targetKey({ kind: 'new' })).toBeNull()
    expect(targetKey({ kind: 'create', key: 'tmp-4' })).toBe('tmp-4')
    expect(targetKey({ kind: 'card', id: 9 })).toBe('9')
  })
})

describe('splitHighlight', () => {
  it('splits around the match regardless of case', () => {
    expect(splitHighlight('When I was young', 'when')).toEqual(['', 'When', ' I was young'])
    expect(splitHighlight('I go home', 'go')).toEqual(['I ', 'go', ' home'])
  })

  it('returns null when there is nothing to highlight', () => {
    expect(splitHighlight('I go home', '')).toBeNull()
    expect(splitHighlight('I go home', 'stay')).toBeNull()
  })
})
