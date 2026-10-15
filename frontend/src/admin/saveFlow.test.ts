import { describe, expect, it } from 'vitest'
import { toChangeset } from './changeset'
import { type Draft, type DraftItem, emptyDraft, isDraftEmpty } from './draft/draft'
import { type FakeApi, createFakeApi, seedCards } from './fakeApi'
import { applyChoices } from './merge/merge'
import {
  type SaveOutcome,
  changeSummary,
  changedFields,
  checkLostResponse,
  conflictCounts,
  conflictGroups,
  conflictSummary,
  createdIds,
  describeFailure,
  describeIssue,
  generatedMessage,
  rejectionFrom,
  reviewItems,
  revisionMatches,
  runSave,
  savedMessage,
  suggestedMessage,
  summaryText,
} from './saveFlow'
import { makeCard } from './testkit'
import { type ChangesetBody, type RevisionInfo, cardKey, pickCard } from './types'

function server(count = 6): FakeApi {
  return createFakeApi({ cards: seedCards(count), revision: 1 })
}

function item(fake: FakeApi, id: number, kind: 'update' | 'archive' | 'restore', edit: Partial<ReturnType<typeof pickCard>> = {}): DraftItem {
  const card = fake.card(id)
  const base = pickCard(card)
  if (kind === 'archive') return { kind, baseVersion: card.version, base }
  if (kind === 'restore') return Object.keys(edit).length > 0 ? { kind, baseVersion: card.version, base, card: { ...base, ...edit } } : { kind, baseVersion: card.version, base }
  return { kind, baseVersion: card.version, base, card: { ...base, ...edit } }
}

function draftOf(fake: FakeApi, items: Record<string, DraftItem>, extra: Partial<Draft> = {}): Draft {
  return { ...emptyDraft(1, fake.revision()), items, ...extra }
}

const saved = (outcome: SaveOutcome) => {
  if (outcome.kind !== 'saved') throw new Error(`expected saved, got ${outcome.kind}`)
  return outcome
}

const luggage = makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' })
const delay = makeCard({ word: 'delay', pos: 'noun', translation: 'задержка' })

describe('comment and summary', () => {
  const body = (extra: Partial<ChangesetBody>): ChangesetBody => ({ baseRevision: 1, create: [], update: [], archive: [], restore: [], imports: [], ...extra })
  const file = { fileName: 'travel.json', cards: [delay] }

  it('generates the same text as the server does for an empty comment', () => {
    expect(generatedMessage(body({ create: [luggage] }))).toBe('Правки карточек')
    expect(generatedMessage(body({ imports: [file] }))).toBe('Импорт: travel.json')
    expect(generatedMessage(body({ imports: [file], create: [luggage] }))).toBe('Импорт: travel.json и правки')
    expect(generatedMessage(body({ imports: [file, { fileName: 'b.json', cards: [luggage] }] }))).toBe('Импорт: travel.json, b.json')
  })

  it('ignores files without rows, like the server', () => {
    expect(generatedMessage(body({ imports: [{ fileName: 'empty.json', cards: [] }], create: [luggage] }))).toBe('Правки карточек')
  })

  it('suggests the label of the draft first (a rollback), then the generated text', () => {
    const fake = server()
    expect(suggestedMessage(draftOf(fake, { 'tmp-1': { kind: 'create', card: luggage } }, { message: 'Откат к r40' }))).toBe('Откат к r40')
    expect(suggestedMessage(draftOf(fake, { 'tmp-1': { kind: 'create', card: luggage } }, { message: '  ' }))).toBe('Правки карточек')
    expect(suggestedMessage(draftOf(fake, {}, { imports: [{ fileName: 'travel.json', cards: [delay], preview: { added: 1, skipped: 0, errors: 0 } }] }))).toBe('Импорт: travel.json')
  })

  it('counts +added ~changed −archived: new, imported and restored cards add to the deck', () => {
    const fake = server()
    const draft = draftOf(
      fake,
      {
        'tmp-1': { kind: 'create', card: luggage },
        '101': item(fake, 101, 'update', { translation: 'иначе' }),
        '102': item(fake, 102, 'archive'),
        '103': item(fake, 103, 'restore'),
      },
      { imports: [{ fileName: 'travel.json', cards: [delay, makeCard({ word: 'arrive', translation: 'прибывать', pos: 'verb' })], preview: { added: 2, skipped: 0, errors: 0 } }] },
    )
    expect(changeSummary(draft)).toEqual({ added: 4, changed: 1, archived: 1 })
    expect(summaryText(draft)).toBe('r1 → r2 · +4 ~1 −1')
  })
})

describe('reviewItems', () => {
  it('lists new cards first by number, then the rest by word, with versions and changed fields', () => {
    const fake = server()
    const first = fake.card(101)
    const items = reviewItems(
      draftOf(fake, {
        'tmp-10': { kind: 'create', card: delay },
        'tmp-2': { kind: 'create', card: luggage },
        '102': item(fake, 102, 'archive'),
        '101': item(fake, 101, 'update', { translation: 'иначе', usage: 'Новое.' }),
        '103': item(fake, 103, 'restore', { grammar: 'Правка.' }),
      }),
    )
    expect(items.map((i) => i.key)).toEqual(['tmp-2', 'tmp-10', '101', '102', '103'])
    expect(items[0]).toMatchObject({ kind: 'create', word: 'luggage', version: 'новая · v1' })
    expect(items[2]).toMatchObject({ kind: 'update', word: first.word, version: `v${first.version} → v${first.version + 1}`, changed: 'Перевод, Контекст и стиль' })
    expect(items[3]).toMatchObject({ kind: 'archive', changed: '' })
    expect(items[4]).toMatchObject({ kind: 'restore', changed: 'Грамматика' })
  })

  it('finds the fields that differ from the base', () => {
    const base = makeCard()
    expect(changedFields(base, base)).toEqual([])
    expect(changedFields(base, { ...base, example: 'x', translation: 'y' })).toEqual(['translation', 'example'])
  })
})

describe('describeIssue and rejectionFrom', () => {
  const draft = (fake: FakeApi) =>
    draftOf(fake, {
      'tmp-3': { kind: 'create', card: luggage },
      '101': item(fake, 101, 'update', { translation: 'иначе' }),
      '103': item(fake, 103, 'restore', { translation: 'иначе' }),
      '102': item(fake, 102, 'archive'),
    }, { imports: [{ fileName: 'travel.json', cards: [delay], preview: { added: 1, skipped: 0, errors: 0 } }] })

  it('translates field errors by their code and keeps unknown ones as they came', () => {
    expect(describeIssue({ section: 'create', index: 0, field: 'word', code: 'invalid_chars', message: 'x' })).toBe('Слово: Только латиница, апостроф, дефис и одиночные пробелы')
    expect(describeIssue({ section: 'update', index: 0, id: 5, code: 'no_changes', message: 'x' })).toBe('Карточка не отличается от сохранённой.')
    expect(describeIssue({ section: 'changeset', index: 0, field: 'message', code: 'too_long', message: 'x' })).toContain('не больше 500')
    expect(describeIssue({ section: 'changeset', index: 0, code: 'too_many_items', message: 'limit 1000' })).toBe('limit 1000')
  })

  it('points a duplicate at the draft element by section and index', () => {
    const fake = server()
    const built = toChangeset(draft(fake))
    const create = rejectionFrom({ kind: 'duplicate_card', section: 'create', index: 0, id: null }, built)
    expect(create.problems.map((p) => p.key)).toEqual(['tmp-3'])
    const restore = rejectionFrom({ kind: 'duplicate_card', section: 'restore', index: 0, id: 103 }, built)
    expect(restore.problems.map((p) => p.key)).toEqual(['103'])
  })

  it('maps update errors through the update list, where a restore with edits sits too', () => {
    const fake = server()
    const built = toChangeset(draft(fake))
    expect(built.updateKeys).toEqual(['101', '103'])
    const out = rejectionFrom(
      { kind: 'validation', code: 'invalid_argument', message: 'm', errors: [{ section: 'update', index: 1, id: 103, field: 'translation', code: 'required', message: 'm' }] },
      built,
    )
    expect(out.problems).toEqual([{ key: '103', messages: ['Перевод: Обязательное поле'] }])
  })

  it('groups the rows of a file under the file and sends nameless errors to the general list', () => {
    const fake = server()
    const built = toChangeset(draft(fake))
    const out = rejectionFrom(
      {
        kind: 'validation',
        code: 'invalid_argument',
        message: 'm',
        errors: [
          { section: 'imports', index: 0, file: 'travel.json', field: 'word', code: 'required', message: 'm' },
          { section: 'imports', index: 4, file: 'travel.json', field: 'pos', code: 'unsupported_pos', message: 'm' },
          { section: 'changeset', index: 0, code: 'too_many_items', message: 'too many' },
          { section: 'imports', index: 0, file: 'ghost.json', field: 'word', code: 'required', message: 'm' },
        ],
      },
      built,
    )
    expect(out.problems).toEqual([{ key: 'import:0', messages: ['Строка 1. Слово: Обязательное поле', 'Строка 5. Часть речи: Допустимо: глагол, существительное, прилагательное, наречие'] }])
    expect(out.general).toEqual(['too many', 'Файл «ghost.json»: Слово: Обязательное поле'])
  })

  it('falls back to the plain error text when the server named nothing', () => {
    const fake = server()
    const out = rejectionFrom({ kind: 'validation', code: 'invalid_argument', message: 'Сервер не принял данные.', errors: [] }, toChangeset(draft(fake)))
    expect(out).toEqual({ problems: [], general: ['Сервер не принял данные.'] })
  })
})

describe('revisionMatches', () => {
  const body: ChangesetBody = {
    baseRevision: 4,
    message: 'Правки примеров',
    create: [luggage],
    update: [{ id: 1, baseVersion: 1, card: delay }],
    archive: [{ id: 2, baseVersion: 1 }],
    restore: [],
    imports: [{ fileName: 'travel.json', cards: [delay, luggage] }],
  }
  const info: RevisionInfo = {
    revision: 5,
    baseRevision: 4,
    author: 'admin',
    message: 'Правки примеров',
    source: 'editor',
    created: 3,
    updated: 1,
    archived: 1,
    restored: 0,
    importedFiles: [{ name: 'travel.json', added: 2, skipped: 0 }],
    createdAt: '2026-10-12T10:00:00Z',
  }

  it('accepts the revision this body produces, with duplicates skipped by the server', () => {
    expect(revisionMatches(info, body)).toBe(true)
    expect(revisionMatches({ ...info, created: 2, importedFiles: [{ name: 'travel.json', added: 1, skipped: 1 }] }, body)).toBe(true)
  })

  it('rejects anything that differs: base, author, comment, counters, files', () => {
    const different: Partial<RevisionInfo>[] = [
      { revision: 6 },
      { baseRevision: 3 },
      { author: 'system' },
      { message: 'Другой комментарий' },
      { source: 'import' },
      { created: 0 },
      { created: 9 },
      { updated: 2 },
      { archived: 0 },
      { restored: 1 },
      { importedFiles: [] },
      { importedFiles: [{ name: 'other.json', added: 2, skipped: 0 }] },
      { importedFiles: [{ name: 'travel.json', added: 1, skipped: 0 }] },
    ]
    const accepted = different.filter((patch) => revisionMatches({ ...info, ...patch }, body)).map((patch) => JSON.stringify(patch))
    expect(accepted).toEqual([])
  })

  it('compares the generated comment when the sent one was empty', () => {
    const empty: ChangesetBody = { ...body, message: undefined }
    expect(revisionMatches({ ...info, message: 'Импорт: travel.json и правки' }, empty)).toBe(true)
    expect(revisionMatches(info, empty)).toBe(false)
  })
})

describe('runSave: success', () => {
  it('writes a mixed draft as one revision and reports what the server did with the file', async () => {
    const fake = server()
    fake.archiveCard(105)
    const draft = draftOf(
      fake,
      {
        'tmp-1': { kind: 'create', card: luggage },
        '101': item(fake, 101, 'update', { translation: 'иначе' }),
        '102': item(fake, 102, 'archive'),
        '105': item(fake, 105, 'restore', { usage: 'С правкой.' }),
      },
      { imports: [{ fileName: 'travel.json', cards: [delay, makeCard(pickCard(fake.card(103)))], preview: { added: 2, skipped: 0, errors: 0 } }] },
    )

    const outcome = saved(await runSave(fake.api, draft, ''))
    expect(outcome.revision).toBe(3)
    expect(outcome.recovered).toBe(false)
    expect(fake.revision()).toBe(3)
    expect(fake.card(101).translation).toBe('иначе')
    expect(fake.card(102).archived).toBe(true)
    expect(fake.card(105)).toMatchObject({ archived: false, usage: 'С правкой.' })
    expect(outcome.result?.imports[0]).toMatchObject({ fileName: 'travel.json', added: 1, skipped: [{ index: 1, reason: 'duplicate' }] })
    expect(fake.revisionLog()[0]).toMatchObject({ revision: 3, baseRevision: 2, message: 'Импорт: travel.json и правки', created: 2, updated: 2, archived: 1, restored: 1 })

    expect(savedMessage(outcome)).toBe('Сохранено как r3. Каталог для учеников обновлён. «travel.json»: добавлено 1, пропущено как дубли 1')
    const ids = createdIds(outcome.built, outcome.result)
    expect(Object.keys(ids)).toEqual(['tmp-1'])
    expect(fake.card(ids['tmp-1']).word).toBe('luggage')
  })

  it('sends If-Match through the client and the typed comment', async () => {
    const fake = server()
    const draft = draftOf(fake, { 'tmp-1': { kind: 'create', card: luggage } })
    saved(await runSave(fake.api, draft, '  Багаж  '))
    expect(fake.revisionLog()[0].message).toBe('Багаж')
    expect((fake.callsOf('save')[0][0] as ChangesetBody).baseRevision).toBe(1)
  })

  it('says nothing extra when the server added the whole file', async () => {
    const fake = server()
    const draft = draftOf(fake, {}, { imports: [{ fileName: 'travel.json', cards: [delay], preview: { added: 1, skipped: 0, errors: 0 } }] })
    expect(savedMessage(saved(await runSave(fake.api, draft, '')))).toBe('Сохранено как r2. Каталог для учеников обновлён')
  })
})

describe('runSave: the deck moved on (412)', () => {
  async function conflicted() {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.editCard(101, { translation: 'чужое', usage: 'Чужое уточнение.' })
    const outcome = await runSave(fake.api, draft, 'Мой комментарий')
    return { fake, draft, outcome }
  }

  it('writes nothing and hands over the merge: one field to choose, one pulled in automatically', async () => {
    const { fake, outcome } = await conflicted()
    expect(outcome.kind).toBe('conflict')
    if (outcome.kind !== 'conflict') return
    expect(outcome.cause).toBe('revision')
    expect(outcome.serverRevision).toBe(2)
    expect(fake.revisionLog()).toEqual([])
    expect(outcome.merge.conflicts).toMatchObject([{ kind: 'fields', key: '101', fields: [{ field: 'translation', mine: 'моё', theirs: 'чужое' }] }])
    expect(outcome.merge.autoMerged).toMatchObject([{ key: '101', fields: ['usage'] }])
    expect(outcome.merge.rebasedDraft.baseRevision).toBe(2)
  })

  it('keeps my value by default and saves on top of the new revision', async () => {
    const { fake, outcome } = await conflicted()
    if (outcome.kind !== 'conflict') throw new Error('no conflict')
    const resolved = applyChoices(outcome.merge.rebasedDraft, outcome.merge.conflicts, {})
    const done = saved(await runSave(fake.api, resolved, 'Мой комментарий'))
    expect(done.revision).toBe(3)
    expect(fake.card(101)).toMatchObject({ translation: 'моё', usage: 'Чужое уточнение.', version: 3 })
  })

  it('takes the server value when asked, and then nothing of mine is left to save', async () => {
    const { outcome } = await conflicted()
    if (outcome.kind !== 'conflict') throw new Error('no conflict')
    const resolved = applyChoices(outcome.merge.rebasedDraft, outcome.merge.conflicts, { '101:translation': 'theirs' })
    expect(isDraftEmpty(resolved)).toBe(true)
  })

  it('repeats the cycle when the deck moves again while the dialog is open', async () => {
    const { fake, outcome } = await conflicted()
    if (outcome.kind !== 'conflict') throw new Error('no conflict')
    const first = applyChoices(outcome.merge.rebasedDraft, outcome.merge.conflicts, {})
    fake.editCard(101, { translation: 'ещё чужое' })
    const again = await runSave(fake.api, first, '')
    expect(again.kind).toBe('conflict')
    if (again.kind !== 'conflict') return
    expect(again.merge.rebasedDraft.baseRevision).toBe(3)
    expect(again.merge.conflicts).toMatchObject([{ kind: 'fields', fields: [{ field: 'translation', mine: 'моё', theirs: 'ещё чужое' }] }])
    const done = saved(await runSave(fake.api, applyChoices(again.merge.rebasedDraft, again.merge.conflicts, {}), ''))
    expect(done.revision).toBe(4)
    expect(fake.card(101)).toMatchObject({ translation: 'моё', usage: 'Чужое уточнение.' })
  })

  it('a card archived on the server against my edit is a decision about the whole card', async () => {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.archiveCard(101)
    const outcome = await runSave(fake.api, draft, '')
    if (outcome.kind !== 'conflict') throw new Error('no conflict')
    expect(outcome.merge.conflicts).toMatchObject([{ kind: 'archived_on_server', key: '101' }])
    const restored = applyChoices(outcome.merge.rebasedDraft, outcome.merge.conflicts, {})
    expect(restored.items['101']).toMatchObject({ kind: 'restore', card: { translation: 'моё' } })
    saved(await runSave(fake.api, restored, ''))
    expect(fake.card(101)).toMatchObject({ archived: false, translation: 'моё' })
  })

  it('treats a 409 version_mismatch like a 412 when the server really moved', async () => {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.editCard(101, { usage: 'Чужое.' })
    fake.failNext('save', { kind: 'version_mismatch', id: 101, expected: 1, actual: 2 })
    const outcome = await runSave(fake.api, draft, '')
    expect(outcome).toMatchObject({ kind: 'conflict', cause: 'version' })
  })

  it('does not pretend to merge when the server says "version" but nothing new is there', async () => {
    const fake = server()
    const wrong: DraftItem = { kind: 'update', baseVersion: 5, base: pickCard(fake.card(101)), card: { ...pickCard(fake.card(101)), translation: 'моё' } }
    const outcome = await runSave(fake.api, draftOf(fake, { '101': wrong }), '')
    expect(outcome).toMatchObject({ kind: 'stale', error: { kind: 'version_mismatch', id: 101, expected: 5, actual: 1 } })
    expect(fake.revision()).toBe(1)
  })

  it('reports a failed read of the changes instead of losing the draft', async () => {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.editCard(101, { usage: 'Чужое.' })
    fake.failNext('changes', { kind: 'network' })
    expect(await runSave(fake.api, draft, '')).toEqual({ kind: 'failed', error: { kind: 'network' } })
  })

  it('goes to the login when the session ends while the changes are being read', async () => {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.editCard(101, { usage: 'Чужое.' })
    fake.failNext('changes', { kind: 'unauthenticated' })
    expect(await runSave(fake.api, draft, '')).toEqual({ kind: 'unauthenticated' })
  })
})

describe('runSave: the server refuses the content', () => {
  it('names the new card that duplicates an active one', async () => {
    const fake = server()
    const twin = pickCard(fake.card(101))
    const outcome = await runSave(fake.api, draftOf(fake, { 'tmp-1': { kind: 'create', card: twin }, 'tmp-2': { kind: 'create', card: luggage } }), '')
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { problems: [{ key: 'tmp-1' }] } })
    expect(fake.revision()).toBe(1)
  })

  it('names the edited card whose new key is taken', async () => {
    const fake = server()
    const taken = pickCard(fake.card(102))
    const outcome = await runSave(fake.api, draftOf(fake, { '101': item(fake, 101, 'update', { word: taken.word, pos: taken.pos, translation: taken.translation }) }), '')
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { problems: [{ key: '101' }] } })
  })

  it('names the elements with invalid fields, in Russian', async () => {
    const fake = server()
    const bad = makeCard({ word: 'привет', translation: '' })
    const outcome = await runSave(fake.api, draftOf(fake, { 'tmp-1': { kind: 'create', card: bad } }, { imports: [{ fileName: 'x.json', cards: [makeCard({ word: '', translation: 'а' })], preview: { added: 1, skipped: 0, errors: 0 } }] }), '')
    if (outcome.kind !== 'rejected') throw new Error('not rejected')
    expect(outcome.rejection.problems).toEqual([
      { key: 'tmp-1', messages: ['Слово: Только латиница, апостроф, дефис и одиночные пробелы', 'Перевод: Обязательное поле'] },
      { key: 'import:0', messages: ['Строка 1. Слово: Обязательное поле'] },
    ])
  })

  it('names an update that changes nothing', async () => {
    const fake = server()
    const card = pickCard(fake.card(101))
    const same: DraftItem = { kind: 'update', baseVersion: fake.card(101).version, base: { ...card, usage: 'Другое' }, card }
    const outcome = await runSave(fake.api, draftOf(fake, { '101': same }), '')
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { problems: [{ key: '101', messages: ['Карточка не отличается от сохранённой.'] }] } })
  })

  it('an empty draft is a general error, not an element', async () => {
    const fake = server()
    const outcome = await runSave(fake.api, draftOf(fake, {}), '')
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { problems: [], general: ['В черновике нет изменений.'] } })
  })

  it('a too long comment is a general error', async () => {
    const fake = server()
    const outcome = await runSave(fake.api, draftOf(fake, { 'tmp-1': { kind: 'create', card: luggage } }), 'я'.repeat(501))
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { general: ['Комментарий слишком длинный (не больше 500 символов).'] } })
  })
})

describe('runSave: session, network and the lost answer', () => {
  const create = (fake: FakeApi) => draftOf(fake, { 'tmp-1': { kind: 'create', card: luggage } })

  it('reports an ended session without touching anything', async () => {
    const fake = server()
    fake.setAuthed(false)
    expect(await runSave(fake.api, create(fake), '')).toEqual({ kind: 'unauthenticated' })
  })

  it('a refused request leaves the draft alone and says the deck did not move', async () => {
    const fake = server()
    fake.failNext('save', { kind: 'network' })
    const outcome = await runSave(fake.api, create(fake), '')
    expect(outcome).toEqual({ kind: 'failed', error: { kind: 'network' } })
    expect(fake.revision()).toBe(1)
  })

  it('recognises a write whose answer was lost and does not write it twice', async () => {
    const fake = server()
    fake.loseNextResponse('save', { kind: 'network' })
    const outcome = saved(await runSave(fake.api, create(fake), 'Багаж'))
    expect(outcome).toMatchObject({ revision: 2, recovered: true, result: null })
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.revisionLog()).toHaveLength(1)
    expect(savedMessage(outcome)).toContain('запись нашлась в истории')
  })

  it('also recognises it after a 5xx, and when the deck moved on again after our write', async () => {
    const fake = server()
    fake.loseNextResponse('save', { kind: 'server', status: 502, message: '' })
    const draft = create(fake)
    const original = fake.api.deck
    fake.api.deck = async (...args) => {
      fake.editCard(102, { usage: 'Позже.' })
      return original(...args)
    }
    const outcome = saved(await runSave(fake.api, draft, ''))
    fake.api.deck = original
    expect(outcome).toMatchObject({ revision: 2, recovered: true })
    expect(fake.revision()).toBe(3)
  })

  it('a write that never happened is a plain failure that can be repeated', async () => {
    const fake = server()
    fake.failNext('save', { kind: 'server', status: 503, message: '' })
    const draft = create(fake)
    expect(await runSave(fake.api, draft, '')).toMatchObject({ kind: 'failed', error: { kind: 'server', status: 503 } })
    saved(await runSave(fake.api, draft, ''))
    expect(fake.revisionLog()).toHaveLength(1)
  })

  it('when the deck moved and the next revision is not ours, it is an ordinary conflict', async () => {
    const fake = server()
    const draft = draftOf(fake, { '101': item(fake, 101, 'update', { translation: 'моё' }) })
    fake.editCard(101, { translation: 'чужое' })
    fake.failNext('save', { kind: 'network' })
    const outcome = await runSave(fake.api, draft, '')
    expect(outcome).toMatchObject({ kind: 'conflict', cause: 'revision', serverRevision: 2 })
  })

  it('cannot verify without a connection and leaves the decision to a repeat', async () => {
    const fake = server()
    const draft = create(fake)
    fake.loseNextResponse('save', { kind: 'network' })
    fake.failNext('deck', { kind: 'network' })
    expect(await runSave(fake.api, draft, '')).toEqual({ kind: 'failed', error: { kind: 'network' } })
    const again = await runSave(fake.api, draft, '')
    expect(again.kind).toBe('conflict')
    expect(fake.revisionLog()).toHaveLength(1)
  })

  it('does not look for a lost answer after a refusal that is not about the network', async () => {
    const fake = server()
    fake.failNext('save', { kind: 'payload_too_large' })
    expect(await runSave(fake.api, create(fake), '')).toEqual({ kind: 'failed', error: { kind: 'payload_too_large' } })
    fake.failNext('save', { kind: 'server', status: 404, message: 'nope' })
    expect(await runSave(fake.api, create(fake), '')).toMatchObject({ kind: 'failed' })
    expect(fake.callsOf('deck')).toHaveLength(0)
  })

  it('checkLostResponse tells the four cases apart', async () => {
    const fake = server()
    const body = toChangeset(create(fake), 'Багаж').body
    expect(await checkLostResponse(fake.api, body)).toEqual({ kind: 'not_applied' })
    await fake.api.save(body)
    expect(await checkLostResponse(fake.api, body)).toEqual({ kind: 'applied', revision: 2 })
    expect(await checkLostResponse(fake.api, { ...body, message: 'Другой' })).toEqual({ kind: 'moved', current: 2 })
    fake.failNext('deck', { kind: 'network' })
    expect(await checkLostResponse(fake.api, body)).toEqual({ kind: 'unknown' })
  })
})

describe('the conflict dialog model', () => {
  it('puts cards that need a decision first and adds the ones with only automatic fields', async () => {
    const fake = server()
    const draft = draftOf(fake, {
      '101': item(fake, 101, 'update', { translation: 'моё' }),
      '102': item(fake, 102, 'update', { translation: 'тоже моё' }),
      '103': item(fake, 103, 'archive'),
    })
    fake.editCard(102, { usage: 'Чужое.' })
    fake.editCard(101, { translation: 'чужое' })
    fake.editCard(103, { usage: 'Тоже чужое.' })
    const outcome = await runSave(fake.api, draft, '')
    if (outcome.kind !== 'conflict') throw new Error('no conflict')

    const groups = conflictGroups(outcome.merge)
    expect(groups.map((g) => [g.key, g.conflict?.kind ?? null, g.auto])).toEqual([
      ['101', 'fields', []],
      ['103', 'changed_on_server', []],
      ['102', null, ['usage']],
    ])
    const counts = conflictCounts(outcome.merge)
    expect(counts).toEqual({ fields: 1, cards: 1, auto: 1 })
    expect(conflictSummary(counts)).toBe('В 1 поле вы и кто-то ещё внесли разные правки. 1 карточка требует отдельного решения. Выберите, что оставить. Ещё 1 поле с сервера подтянется автоматически, вы его не меняли.')
  })

  it('declines «поле» after «В» for any number', () => {
    const text = (fields: number) => conflictSummary({ fields, cards: 0, auto: 0 }).split(' вы и кто-то ещё')[0]
    expect([1, 2, 4, 5, 11, 21, 22].map(text)).toEqual(['В 1 поле', 'В 2 полях', 'В 4 полях', 'В 5 полях', 'В 11 полях', 'В 21 поле', 'В 22 полях'])
  })

  it('says nothing needs choosing when the edits did not meet', () => {
    expect(conflictSummary({ fields: 0, cards: 0, auto: 0 })).toBe('Ваши правки ни с чем не пересеклись, выбирать ничего не нужно.')
    expect(conflictSummary({ fields: 0, cards: 0, auto: 3 })).toBe('Ваши правки ни с чем не пересеклись, выбирать ничего не нужно. Ещё 3 поля с сервера подтянутся автоматически, вы их не меняли.')
  })
})

describe('describeFailure', () => {
  it('always says the draft is in place', () => {
    expect(describeFailure({ kind: 'network' })).toBe('Не удалось сохранить, черновик на месте. Нет связи с сервером.')
    expect(describeFailure({ kind: 'server', status: 500, message: '' })).toContain('черновик на месте')
  })
})

describe('keys of a card are compared the way the server does', () => {
  it('uses the same duplicate rule as the editor: word without case, pos, translation', () => {
    expect(cardKey(makeCard({ word: 'When' }))).toBe(cardKey(makeCard({ word: 'when' })))
  })
})
