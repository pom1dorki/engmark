import { describe, expect, it } from 'vitest'
import type { AdminApi } from './api/admin'
import { createFakeApi, seedCards } from './fakeApi'
import { prepareRevert, revertSummary } from './revert'
import { makeServerCard } from './testkit'
import type { Changes, ChangesetBody } from './types'

function setup() {
  return createFakeApi({ cards: seedCards(10) })
}

describe('prepareRevert', () => {
  it('builds a draft that returns every card touched after the revision to its old state', async () => {
    const fake = setup()
    const before = fake.card(101)
    fake.editCard(101, { translation: 'другой перевод' })
    const added = fake.addCard({ word: 'extra', translation: 'лишнее' })
    fake.archiveCard(103)
    expect(added).toBe(3)

    const result = await prepareRevert(fake.api, 1, 1)
    expect(result.kind).toBe('draft')
    if (result.kind !== 'draft') return
    const { draft } = result
    expect(draft).toMatchObject({ deckId: 1, baseRevision: 4, message: 'Откат к r1', imports: [] })

    expect(draft.items['101']).toMatchObject({ kind: 'update', baseVersion: 2, card: { translation: before.translation } })
    expect(draft.items['101'].kind === 'update' && draft.items['101'].base.translation).toBe('другой перевод')
    const newId = Math.max(...Object.keys(draft.items).map(Number))
    expect(draft.items[String(newId)]).toMatchObject({ kind: 'archive', baseVersion: 1 })
    expect(draft.items['103']).toMatchObject({ kind: 'restore', baseVersion: 4 })
    expect(draft.items['103'].kind === 'restore' && draft.items['103'].card).toBeUndefined()
  })

  it('returns an archived and edited card together with the old content', async () => {
    const fake = setup()
    const first = fake.card(101)
    fake.editCard(101, { translation: 'правка' })
    fake.archiveCard(101)

    const result = await prepareRevert(fake.api, 1, 1)
    expect(result.kind === 'draft' && result.draft.items['101']).toMatchObject({ kind: 'restore', baseVersion: 3, card: { translation: first.translation } })
  })

  it('has nothing to do when the deck already matches the revision', async () => {
    const fake = setup()
    expect(await prepareRevert(fake.api, 1, 1)).toEqual({ kind: 'nothing' })
  })

  it('has nothing to do when later edits cancelled each other out', async () => {
    const fake = setup()
    const original = fake.card(101).translation
    fake.editCard(101, { translation: 'временно' })
    fake.editCard(101, { translation: original })
    expect(await prepareRevert(fake.api, 1, 1)).toEqual({ kind: 'nothing' })
  })

  it('does not build a draft when the deck moved between the two answers', async () => {
    const fake = setup()
    fake.editCard(101, { translation: 'правка' })
    const racing: AdminApi = {
      ...fake.api,
      changes: async (since, options) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        fake.editCard(102, { translation: 'ещё правка' })
        return fake.api.changes(since, options)
      },
    }
    expect(await prepareRevert(racing, 1, 1)).toEqual({ kind: 'stale' })
  })

  it('does not build a draft when a card version differs although the revision matches', async () => {
    const body: ChangesetBody = { baseRevision: 5, message: 'Откат к r1', create: [], update: [], archive: [{ id: 9, baseVersion: 2 }], restore: [], imports: [] }
    const changes: Changes = { revision: 5, since: 1, items: [{ current: makeServerCard(9, 3), base: null }] }
    const api = {
      revertDraft: async () => ({ ok: true, value: body, etag: null, notModified: false }),
      changes: async () => ({ ok: true, value: changes, etag: null, notModified: false }),
    } as unknown as AdminApi
    expect(await prepareRevert(api, 1, 1)).toEqual({ kind: 'stale' })
  })

  it('does not build a draft when the changes do not mention a card of the changeset', async () => {
    const body: ChangesetBody = { baseRevision: 5, message: 'Откат к r1', create: [], update: [], archive: [{ id: 9, baseVersion: 2 }], restore: [], imports: [] }
    const api = {
      revertDraft: async () => ({ ok: true, value: body, etag: null, notModified: false }),
      changes: async () => ({ ok: true, value: { revision: 5, since: 1, items: [] }, etag: null, notModified: false }),
    } as unknown as AdminApi
    expect(await prepareRevert(api, 1, 1)).toEqual({ kind: 'stale' })
  })

  it('passes errors of either request on', async () => {
    const first = setup()
    first.editCard(101, { translation: 'правка' })
    first.failNext('revertDraft', { kind: 'not_found', message: 'revision r9 not found' })
    expect(await prepareRevert(first.api, 1, 9)).toEqual({ kind: 'error', error: { kind: 'not_found', message: 'revision r9 not found' } })

    const second = setup()
    second.editCard(101, { translation: 'правка' })
    second.failNext('changes', { kind: 'network' })
    expect(await prepareRevert(second.api, 1, 1)).toEqual({ kind: 'error', error: { kind: 'network' } })
  })
})

describe('revertSummary', () => {
  it('says in words what the revert draft holds', async () => {
    const fake = setup()
    fake.editCard(101, { translation: 'правка' })
    fake.addCard({ word: 'extra', translation: 'лишнее' })
    fake.archiveCard(103)
    const result = await prepareRevert(fake.api, 1, 1)
    expect(result.kind === 'draft' && revertSummary(result.draft)).toBe('изменено 1, вернётся из архива 1, уйдёт в архив 1')
  })
})
