import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Draft, emptyDraft } from '../draft/draft'
import { DRAFT_KEY } from '../draft/storage'
import { type FakeApi, createFakeApi, seedCards } from '../fakeApi'
import { pickCard } from '../types'
import { makeCard } from '../testkit'
import Workspace from './Workspace'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

interface Options {
  pollMs?: number
  latency?: number
  before?: (fake: FakeApi) => void
}

let signedInAgain: () => void = () => undefined

async function open(options: Options = {}) {
  const fake = createFakeApi({ cards: seedCards(120), latency: options.latency })
  options.before?.(fake)
  let epoch = 0
  const ui = () => <Workspace api={fake.api} pollMs={options.pollMs ?? 600_000} epoch={epoch} />
  const view = render(ui())
  signedInAgain = () => {
    epoch += 1
    view.rerender(ui())
  }
  await screen.findByRole('heading', { name: 'Слова' })
  await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
  return fake
}

const bodyRows = () => screen.queryAllByRole('row').slice(1)
const rowOf = (word: string) => screen.getByRole('row', { name: new RegExp(`^${word} `) })
const bar = () => screen.queryByRole('region', { name: 'Черновик' })
const reviewDialog = () => screen.queryByRole('dialog', { name: 'Сохранить изменения' })
const conflictDialog = () => screen.queryByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
const comment = () => screen.getByLabelText('Комментарий к ревизии') as HTMLInputElement
const saveButton = () => within(reviewDialog() as HTMLElement).getByRole('button', { name: 'Сохранить' })
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

function stored(build: (draft: Draft) => void) {
  const draft = emptyDraft(1, 1)
  build(draft)
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

async function editTranslation(word: string, value: string) {
  fireEvent.click(rowOf(word))
  await screen.findByRole('complementary', { name: 'Редактор карточки' })
  const field = await screen.findByLabelText('Перевод')
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
  await screen.findByText(`Правки «${word}» в черновике · основа v1`)
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull())
}

function openReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
  expect(reviewDialog()).toBeTruthy()
}

const SAVED_R2 = 'Сохранено как r2. Каталог для учеников обновлён'

describe('Workspace: saving', () => {
  it('saves the edit as one revision, clears the draft and refreshes the list and the base', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    openReview()
    expect(within(reviewDialog() as HTMLElement).getByText('r1 → r2 · +0 ~1 −0')).toBeTruthy()
    expect(comment().value).toBe('Правки карточек')

    fireEvent.click(saveButton())
    expect(await screen.findByText(SAVED_R2)).toBeTruthy()
    expect(reviewDialog()).toBeNull()
    expect(bar()).toBeNull()
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
    await screen.findByText('основа r2')
    await waitFor(() => expect(within(rowOf('ba')).getByText('новый перевод')).toBeTruthy())
    expect(within(rowOf('ba')).getByText('Опубликовано')).toBeTruthy()

    expect(fake.revision()).toBe(2)
    expect(fake.card(101)).toMatchObject({ translation: 'новый перевод', version: 2 })
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.callsOf('save')[0][0]).toMatchObject({ baseRevision: 1, update: [{ id: 101, baseVersion: 1 }] })
  })

  it('sends the typed comment and the server keeps it in the history', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    openReview()
    fireEvent.change(comment(), { target: { value: 'Уточнил перевод' } })
    fireEvent.click(saveButton())
    await screen.findByText(SAVED_R2)
    expect(fake.revisionLog()[0]).toMatchObject({ revision: 2, message: 'Уточнил перевод', source: 'editor', updated: 1 })
  })

  it('opens the same dialog from «Просмотреть» and closes it with «Назад» and Esc without touching the draft', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fireEvent.click(screen.getByRole('button', { name: 'Просмотреть' }))
    expect(reviewDialog()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(reviewDialog()).toBeNull()
    openReview()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(reviewDialog()).toBeNull()
    expect(bar()?.textContent).toContain('1 изменено')
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(fake.callsOf('save')).toHaveLength(0)
  })

  it('sends only one request on a double press and blocks the window while it runs', async () => {
    const fake = await open({ latency: 25 })
    await editTranslation('ba', 'новый перевод')
    openReview()
    fireEvent.click(saveButton())
    const busy = within(reviewDialog() as HTMLElement).getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    fireEvent.click(busy)
    fireEvent.keyDown(comment(), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(reviewDialog()).toBeTruthy()
    await screen.findByText(SAVED_R2)
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.revision()).toBe(2)
  })

  it('saves a new word together with an edit and moves an open editor to the real card', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fireEvent.click(screen.getByRole('button', { name: 'Новое слово' }))
    await screen.findByRole('complementary', { name: 'Редактор карточки' })
    fireEvent.change(screen.getByLabelText('Слово'), { target: { value: 'fresh' } })
    fireEvent.change(screen.getByLabelText('Перевод'), { target: { value: 'свежий' } })
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }))
    await screen.findByText('«fresh» добавлено в черновик')
    fireEvent.click(within(bodyRows()[0]).getByText('fresh'))
    await screen.findByText('Новая карточка в черновике')

    openReview()
    expect(within(reviewDialog() as HTMLElement).getByText('r1 → r2 · +1 ~1 −0')).toBeTruthy()
    fireEvent.click(saveButton())
    await screen.findByText(SAVED_R2)
    const meta = await screen.findByText(/^ID 221 · версия v1/)
    expect(meta).toBeTruthy()
    expect(fake.card(221)).toMatchObject({ word: 'fresh', translation: 'свежий', version: 1 })
  })

  it('saves a file from the draft and names the file where the server skipped duplicates', async () => {
    const fake = await open({
      before: () =>
        stored((draft) => {
          draft.imports.push({
            fileName: 'kept.json',
            cards: [makeCard({ word: 'fresh', translation: 'свежий', pos: 'noun' }), makeCard({ word: 'ba', translation: 'перевод 1', pos: 'verb' })],
            preview: { added: 2, skipped: 0, errors: 0 },
          })
        }),
    })
    openReview()
    expect(comment().value).toBe('Импорт: kept.json')
    fireEvent.click(saveButton())
    expect(await screen.findByText(`${SAVED_R2}. «kept.json»: добавлено 1, пропущено как дубли 1`)).toBeTruthy()
    expect(fake.revisionLog()[0]).toMatchObject({ source: 'import', created: 1, importedFiles: [{ name: 'kept.json', added: 1, skipped: 1 }] })
    expect(bar()).toBeNull()
  })
})

describe('Workspace: the deck moved on while saving (412 and 409 version)', () => {
  it('shows the conflict dialog even when nothing overlaps, writes nothing, and applies on top of the new revision', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.editCard(105, { usage: 'С сервера' })
    fireEvent.click(saveButton())

    const dialog = await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    expect(dialog.textContent).toContain('Вы начали с ревизии r1, на сервере уже r2. Ничего не записано.')
    expect(dialog.textContent).toContain('Ваши правки ни с чем не пересеклись, выбирать ничего не нужно.')
    expect(fake.revisionLog()).toHaveLength(0)
    expect(reviewDialog()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('моя правка')

    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    expect(await screen.findByText('Сохранено как r3. Каталог для учеников обновлён')).toBeTruthy()
    expect(conflictDialog()).toBeNull()
    expect(bar()).toBeNull()
    expect(fake.card(101)).toMatchObject({ translation: 'моя правка', version: 2 })
    expect(fake.card(105).usage).toBe('С сервера')
    expect(fake.callsOf('save').map((args) => (args[0] as { baseRevision: number }).baseRevision)).toEqual([1, 2])
  })

  it('asks only about the field both sides changed and keeps the user choice', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.editCard(101, { translation: 'серверная правка', usage: 'Чужое.' })
    fireEvent.click(saveButton())

    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
    expect(screen.getByText('Автоматически с сервера: Контекст и стиль')).toBeTruthy()
    expect(radio('Ваш вариант: моя правка').checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    await screen.findByText('Сохранено как r3. Каталог для учеников обновлён')
    expect(fake.card(101)).toMatchObject({ translation: 'моя правка', usage: 'Чужое.', version: 3 })
    expect(bar()).toBeNull()
  })

  it('takes the server value when asked, and says so when nothing of the edit is left to save', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.editCard(101, { translation: 'серверная правка', usage: 'Чужое.' })
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })

    fireEvent.click(radio('На сервере: серверная правка'))
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    expect(await screen.findByText('Все ваши правки уже есть на сервере (r2), сохранять нечего')).toBeTruthy()
    expect(conflictDialog()).toBeNull()
    expect(bar()).toBeNull()
    expect(fake.revisionLog()).toHaveLength(0)
    expect(fake.callsOf('save')).toHaveLength(1)
    await waitFor(() => expect(within(rowOf('ba')).getByText('серверная правка')).toBeTruthy())
  })

  it('shows the dialog again when the deck moves once more before «Применить» is pressed', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.editCard(105, { usage: 'Первая серверная' })
    fireEvent.click(saveButton())
    await screen.findByRole('button', { name: 'Применить поверх r2' })

    fake.editCard(106, { usage: 'Вторая серверная' })
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    const again = await screen.findByRole('button', { name: 'Применить поверх r3' })
    expect(again).toBeTruthy()
    expect(screen.getByText('Вы начали с ревизии r2, на сервере уже r3. Ничего не записано.')).toBeTruthy()
    expect(fake.revisionLog()).toHaveLength(0)
    expect(bar()?.textContent).toContain('1 изменено')

    fireEvent.click(again)
    await screen.findByText('Сохранено как r4. Каталог для учеников обновлён')
    expect(fake.card(101).translation).toBe('моя правка')
    expect(fake.callsOf('save').map((args) => (args[0] as { baseRevision: number }).baseRevision)).toEqual([1, 2, 3])
  })

  it('«Позже» closes the dialog, writes nothing and marks the draft as needing a new base', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.editCard(101, { translation: 'серверная правка' })
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })

    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    expect(conflictDialog()).toBeNull()
    expect(await screen.findByText(/Ничего не записано\. Черновик остался на прежней основе/)).toBeTruthy()
    expect(bar()?.textContent).toContain('основан на ревизии r1, на сервере уже r2 · нужно обновить основу')
    expect(localStorage.getItem(DRAFT_KEY)).toContain('моя правка')
    expect(fake.revisionLog()).toHaveLength(0)
    expect(fake.card(101).translation).toBe('серверная правка')
    await screen.findByText(/Колода обновилась до/)
  })

  it('treats 409 version_mismatch like a deck change when the server has newer cards', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    fake.editCard(101, { usage: 'Чужое.' })
    fake.failNext('save', { kind: 'version_mismatch', id: 101, expected: 1, actual: 2 })
    openReview()
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    expect(screen.getByText('Автоматически с сервера: Контекст и стиль')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    await screen.findByText('Сохранено как r3. Каталог для учеников обновлён')
    expect(fake.card(101)).toMatchObject({ translation: 'моя правка', usage: 'Чужое.' })
  })

  it('keeps the draft and explains a version mismatch when the deck did not change', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    fake.failNext('save', { kind: 'version_mismatch', id: 101, expected: 1, actual: 2 })
    openReview()
    fireEvent.click(saveButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('версия карточки №101 не совпала (на сервере v2, в черновике основа v1), хотя колода не менялась')
    expect(reviewDialog()).toBeTruthy()
    expect(conflictDialog()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('моя правка')
    expect(fake.revisionLog()).toHaveLength(0)
  })

  it('drops an edit of a card that was archived on the server when the user declines to bring it back', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.archiveCard(101)
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    expect(screen.getByText('Карточку «ba» отправили в архив на сервере, а вы её правили.')).toBeTruthy()
    expect(radio('Вернуть из архива с моими правками').checked).toBe(true)

    fireEvent.click(radio('Отказаться от моих правок'))
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    await screen.findByText('Все ваши правки уже есть на сервере (r2), сохранять нечего')
    expect(fake.card(101).archived).toBe(true)
    expect(bar()).toBeNull()
  })

  it('brings the archived card back with the edit by default', async () => {
    const fake = await open()
    await editTranslation('ba', 'моя правка')
    openReview()
    fake.archiveCard(101)
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    await screen.findByText('Сохранено как r3. Каталог для учеников обновлён')
    expect(fake.card(101)).toMatchObject({ archived: false, translation: 'моя правка' })
    expect(fake.revisionLog()[0]).toMatchObject({ updated: 1, restored: 1 })
  })
})

describe('Workspace: the server did not accept the content (409 duplicate_card, 400)', () => {
  const duplicateOfBa = () =>
    stored((draft) => {
      draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'ba', translation: 'перевод 1', pos: 'verb' }) }
    })

  it('marks the duplicate, opens it in the editor and keeps the whole draft', async () => {
    const fake = await open({ before: duplicateOfBa })
    openReview()
    fireEvent.click(saveButton())

    await screen.findByRole('complementary', { name: 'Редактор карточки' })
    expect(reviewDialog()).toBeNull()
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Сервер не принял изменения. Ничего не записано, черновик на месте.')
    expect(banner.textContent).toContain('ba: Такая карточка уже есть в колоде')
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    const row = bodyRows()[0]
    expect(row.className).toContain('bad')
    expect(within(row).getByText('Не принято')).toBeTruthy()
    expect(screen.getByText('Новая карточка в черновике')).toBeTruthy()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('"tmp-1"')
    expect(fake.revisionLog()).toHaveLength(0)
    expect(bar()?.textContent).toContain('1 новых')
  })

  it('removes the mark as soon as the marked card is changed, and the next save goes through', async () => {
    const fake = await open({ before: duplicateOfBa })
    openReview()
    fireEvent.click(saveButton())
    await screen.findByRole('complementary', { name: 'Редактор карточки' })

    fireEvent.change(await screen.findByLabelText('Перевод'), { target: { value: 'другой перевод' } })
    fireEvent.click(screen.getByRole('button', { name: 'Обновить в черновике' }))
    await waitFor(() => expect(screen.queryByText(/Сервер не принял изменения/)).toBeNull())
    expect(bodyRows()[0].className).not.toContain('bad')

    openReview()
    fireEvent.click(saveButton())
    await screen.findByText(SAVED_R2)
    expect(fake.revision()).toBe(2)
    expect(bar()).toBeNull()
  })

  it('«Понятно» hides the banner but the draft and the marks in the dialog stay', async () => {
    await open({ before: duplicateOfBa })
    openReview()
    fireEvent.click(saveButton())
    await screen.findByRole('alert')
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(bar()).not.toBeNull()
  })

  it('marks the card with a field error, opens it and lets the person fix it', async () => {
    const fake = await open({
      before: (server) =>
        stored((draft) => {
          const base = pickCard(server.card(101))
          draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, word: 'ba1' } }
        }),
    })
    openReview()
    fireEvent.click(saveButton())

    await screen.findByRole('complementary', { name: 'Редактор карточки' })
    expect(screen.getByRole('alert').textContent).toContain('ba1: Слово: Только латиница, апостроф, дефис и одиночные пробелы')
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0].className).toContain('bad')
    expect(fake.revisionLog()).toHaveLength(0)

    fireEvent.change(await screen.findByLabelText('Слово'), { target: { value: 'bax' } })
    fireEvent.click(screen.getByRole('button', { name: 'Обновить в черновике' }))
    await waitFor(() => expect(screen.queryByText(/Сервер не принял изменения/)).toBeNull())
    openReview()
    fireEvent.click(saveButton())
    await screen.findByText(SAVED_R2)
    expect(fake.card(101).word).toBe('bax')
  })

  it('keeps the window open and names the file when a row of an imported file is rejected', async () => {
    const fake = await open({
      before: () =>
        stored((draft) => {
          draft.imports.push({
            fileName: 'bad.json',
            cards: [makeCard({ word: 'fresh', translation: 'свежий', pos: 'noun' }), makeCard({ word: 'bad word 1', translation: 'плохой', pos: 'noun' })],
            preview: { added: 2, skipped: 0, errors: 0 },
          })
        }),
    })
    openReview()
    fireEvent.click(saveButton())

    await screen.findByText(/Сервер не принял изменения/)
    const alert = within(reviewDialog() as HTMLElement).getByRole('alert')
    expect(alert.textContent).toContain('Сервер не принял изменения. Ничего не записано, черновик на месте.')
    const item = within(screen.getByRole('list', { name: 'Что будет записано' })).getByText('bad.json').closest('li') as HTMLElement
    expect(item.className).toBe('citem bad')
    expect(item.textContent).toContain('Строка 2. Слово: Только латиница')
    expect(fake.revisionLog()).toHaveLength(0)
    expect(localStorage.getItem(DRAFT_KEY)).toContain('bad.json')
    expect(screen.getByText(/не принят сервером: Строка 2/)).toBeTruthy()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Файл «bad.json»')
    expect(banner.textContent).toContain('Строка 2. Слово: Только латиница')
    expect(bar()).not.toBeNull()
  })
})

describe('Workspace: no answer from the server (network, 5xx)', () => {
  it('keeps the draft, says so, and «Повторить» saves', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fake.failNext('save', { kind: 'network' })
    openReview()
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Не удалось сохранить, черновик на месте. Нет связи с сервером.')
    expect(reviewDialog()).toBeTruthy()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(fake.callsOf('deck').length).toBeGreaterThan(1)
    expect(fake.callsOf('revisions')).toHaveLength(0)

    fireEvent.click(within(reviewDialog() as HTMLElement).getByRole('button', { name: 'Повторить' }))
    await screen.findByText(SAVED_R2)
    expect(fake.callsOf('save')).toHaveLength(2)
    expect(fake.revisionLog()).toHaveLength(1)
    expect(bar()).toBeNull()
  })

  it('treats a 503 the same way', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fake.failNext('save', { kind: 'server', status: 503, message: 'unavailable' })
    openReview()
    fireEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось сохранить, черновик на месте.')
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    fireEvent.click(within(reviewDialog() as HTMLElement).getByRole('button', { name: 'Повторить' }))
    await screen.findByText(SAVED_R2)
  })

  it('finds its own revision in the history when only the response was lost, and does not write twice', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fake.loseNextResponse('save', { kind: 'network' })
    openReview()
    fireEvent.click(saveButton())

    expect(await screen.findByText(`${SAVED_R2}. Ответ сервера потерялся по дороге, но запись нашлась в истории`)).toBeTruthy()
    expect(reviewDialog()).toBeNull()
    expect(bar()).toBeNull()
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.revisionLog()).toHaveLength(1)
    expect(fake.card(101).translation).toBe('новый перевод')
    await screen.findByText('основа r2')
  })

  it('also finds its own revision after a 502 from a proxy that dropped the real answer', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fake.loseNextResponse('save', { kind: 'server', status: 502, message: 'bad gateway' })
    openReview()
    fireEvent.click(saveButton())
    expect(await screen.findByText(/Ответ сервера потерялся по дороге, но запись нашлась в истории/)).toBeTruthy()
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.revisionLog()).toHaveLength(1)
  })

  it('closes an open new-card editor when the response was lost, because the real id is unknown', async () => {
    const fake = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Новое слово' }))
    await screen.findByRole('complementary', { name: 'Редактор карточки' })
    fireEvent.change(screen.getByLabelText('Слово'), { target: { value: 'fresh' } })
    fireEvent.change(screen.getByLabelText('Перевод'), { target: { value: 'свежий' } })
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }))
    await screen.findByText('«fresh» добавлено в черновик')
    fireEvent.click(within(bodyRows()[0]).getByText('fresh'))
    await screen.findByText('Новая карточка в черновике')

    fake.loseNextResponse('save', { kind: 'network' })
    openReview()
    fireEvent.click(saveButton())
    await screen.findByText(/Ответ сервера потерялся по дороге/)
    expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull()
    expect(fake.card(221).word).toBe('fresh')
  })

  it('goes to the conflict dialog when no answer came and the deck has moved on with someone else’s revision', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    fake.editCard(105, { usage: 'С сервера' })
    fake.failNext('save', { kind: 'network' })
    openReview()
    fireEvent.click(saveButton())
    await screen.findByRole('dialog', { name: 'Колода изменилась, пока вы работали' })
    expect(fake.revisionLog()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r2' }))
    await screen.findByText('Сохранено как r3. Каталог для учеников обновлён')
  })
})

describe('Workspace: the session ended while saving (401)', () => {
  it('keeps the window open under the sign-in layer, with the comment and the draft intact', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    openReview()
    fireEvent.change(comment(), { target: { value: 'Мой комментарий' } })
    fake.setAuthed(false)
    fireEvent.click(saveButton())

    await waitFor(() => expect(within(reviewDialog() as HTMLElement).getByRole('alert').textContent).toContain('Сессия закончилась'))
    expect(comment().value).toBe('Мой комментарий')
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(bar()?.textContent).toContain('1 изменено')
    expect(fake.revisionLog()).toHaveLength(0)
    expect(within(reviewDialog() as HTMLElement).getByRole('button', { name: 'Повторить' })).toBeTruthy()
  })

  it('after signing in again the same window offers to continue with the same comment', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    openReview()
    fireEvent.change(comment(), { target: { value: 'Мой комментарий' } })
    fake.setAuthed(false)
    fireEvent.click(saveButton())
    await waitFor(() => expect(within(reviewDialog() as HTMLElement).getByRole('alert')).toBeTruthy())

    fake.setAuthed(true)
    signedInAgain()
    await waitFor(() => expect(within(reviewDialog() as HTMLElement).getByRole('status').textContent).toContain('Вы снова вошли, черновик на месте'))
    expect(within(reviewDialog() as HTMLElement).queryByRole('alert')).toBeNull()
    expect(comment().value).toBe('Мой комментарий')
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(saveButton().textContent).toBe('Сохранить')

    fireEvent.click(saveButton())
    await screen.findByText(SAVED_R2)
    expect(fake.revisionLog()[0].message).toBe('Мой комментарий')
    expect(fake.card(101).translation).toBe('новый перевод')
  })

  it('reads the deck and the list again right after signing in, without waiting for the next poll', async () => {
    const fake = await open()
    const decks = fake.callsOf('deck').length
    const lists = fake.callsOf('cards').length
    signedInAgain()
    await waitFor(() => expect(fake.callsOf('deck').length).toBeGreaterThan(decks))
    await waitFor(() => expect(fake.callsOf('cards').length).toBeGreaterThan(lists))
  })
})
