import { describe, expect, it } from 'vitest'
import { createFakeApi, seedCards } from './fakeApi'
import { validateCard } from './validate/validate'
import { cardKey, pickCard } from './types'

describe('seedCards', () => {
  it('makes unique valid cards', () => {
    const cards = seedCards(120)
    expect(new Set(cards.map((c) => c.word)).size).toBe(120)
    for (const card of cards) expect(validateCard(pickCard(card))).toEqual([])
  })
})

describe('createFakeApi', () => {
  it('pages, filters and sorts like the server', async () => {
    const { api } = createFakeApi()
    const first = await api.cards({ limit: 50 })
    if (!first.ok) throw new Error('not ok')
    expect(first.value.items).toHaveLength(50)
    expect(first.value.total).toBe(120)
    const words = first.value.items.map((c) => c.word)
    expect([...words].sort()).toEqual(words)

    const verbs = await api.cards({ pos: 'verb', limit: 200 })
    if (!verbs.ok) throw new Error('not ok')
    expect(verbs.value.items.every((c) => c.pos === 'verb')).toBe(true)

    const incomplete = await api.cards({ state: 'incomplete', limit: 200 })
    if (!incomplete.ok) throw new Error('not ok')
    expect(incomplete.value.total).toBe(40)
  })

  it('returns the same deck object until the revision changes, so polling does not re-render', async () => {
    const fake = createFakeApi()
    const a = await fake.api.deck()
    const b = await fake.api.deck()
    if (!a.ok || !b.ok) throw new Error('not ok')
    expect(a.value).toBe(b.value)
    fake.editCard(101, { translation: 'другое' })
    const c = await fake.api.deck()
    if (!c.ok) throw new Error('not ok')
    expect(c.value.revision).toBe(2)
  })

  it('reports changes since a revision with the state at that revision as base', async () => {
    const fake = createFakeApi({ revision: 5 })
    const before = fake.card(101).translation
    fake.editCard(101, { translation: 'новое' })
    const result = await fake.api.changes(5)
    if (!result.ok) throw new Error('not ok')
    expect(result.value.revision).toBe(6)
    expect(result.value.items).toHaveLength(1)
    expect(result.value.items[0].current.translation).toBe('новое')
    expect(result.value.items[0].base?.card.translation).toBe(before)
  })

  it('answers 401 to data requests when not signed in and accepts the right password', async () => {
    const fake = createFakeApi({ authed: false })
    const denied = await fake.api.deck()
    expect(denied.ok).toBe(false)
    const wrong = await fake.api.login('nope')
    expect(wrong.ok).toBe(false)
    const right = await fake.api.login('secret')
    expect(right.ok).toBe(true)
    expect((await fake.api.deck()).ok).toBe(true)
  })

  it('fails a method on demand', async () => {
    const fake = createFakeApi()
    fake.failNext('card', { kind: 'network' })
    const first = await fake.api.card(101)
    expect(first.ok).toBe(false)
    expect((await fake.api.card(101)).ok).toBe(true)
  })

  describe('export and validation of an import', () => {
    it('exports the active cards in the cards.json shape, without ids', async () => {
      const fake = createFakeApi({ cards: seedCards(5) })
      fake.archiveCard(102)
      const result = await fake.api.exportCurrent()
      if (!result.ok) throw new Error('not ok')
      const rows = JSON.parse(result.value) as Record<string, unknown>[]
      expect(rows).toHaveLength(4)
      expect(Object.keys(rows[0])).toHaveLength(11)
      expect(rows.map((r) => r.word)).toEqual(seedCards(5).filter((c) => c.id !== 102).map((c) => c.word))
    })

    const cardOf = (index: number) => pickCard(seedCards(5)[index])

    it('reports the rows that already exist as duplicates, by their position in the sent file', async () => {
      const { api } = createFakeApi({ cards: seedCards(5) })
      const fresh = { ...cardOf(0), word: 'fresh' }
      const result = await api.validate({ baseRevision: 1, imports: [{ fileName: 'a.json', cards: [fresh, cardOf(1), { ...fresh, word: 'FRESH' }, cardOf(3)] }] })
      if (!result.ok) throw new Error('not ok')
      expect(result.value.imports).toEqual([
        { fileName: 'a.json', added: 1, skipped: [{ index: 1, reason: 'duplicate' }, { index: 2, reason: 'duplicate' }, { index: 3, reason: 'duplicate' }] },
      ])
      expect(cardKey(fresh)).toBe(cardKey({ ...fresh, word: 'FRESH' }))
    })

    it('does not count archived cards as taken', async () => {
      const fake = createFakeApi({ cards: seedCards(5) })
      fake.archiveCard(101)
      const result = await fake.api.validate({ baseRevision: 1, imports: [{ fileName: 'a.json', cards: [cardOf(0)] }] })
      if (!result.ok) throw new Error('not ok')
      expect(result.value.imports[0].added).toBe(1)
    })

    it('refuses an empty changeset', async () => {
      const { api } = createFakeApi()
      const result = await api.validate({ baseRevision: 1, imports: [{ fileName: 'a.json', cards: [] }] })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.kind === 'validation' && result.error.code).toBe('empty_changeset')
    })
  })
})
