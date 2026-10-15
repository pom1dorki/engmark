import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDraft } from '../draft/draft'
import { DRAFT_KEY } from '../draft/storage'
import { type FakeApi, createFakeApi, seedCards } from '../fakeApi'
import { makeCard } from '../testkit'
import Workspace from './Workspace'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

async function open(options: { pollMs?: number; before?: (fake: FakeApi) => void } = {}) {
  const fake = createFakeApi({ cards: seedCards(120) })
  options.before?.(fake)
  render(<Workspace api={fake.api} pollMs={options.pollMs ?? 600_000} />)
  await screen.findByRole('heading', { name: 'Слова' })
  await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
  return fake
}

const bodyRows = () => screen.queryAllByRole('row').slice(1)
const rowOf = (word: string) => screen.getByRole('row', { name: new RegExp(`^${word} `) })
const search = () => screen.getByRole('searchbox', { name: 'Поиск' }) as HTMLInputElement
const editor = () => screen.findByRole('complementary', { name: 'Редактор карточки' })
const bar = () => screen.queryByRole('region', { name: 'Черновик' })

async function editTranslation(word: string, value: string) {
  fireEvent.click(rowOf(word))
  await editor()
  const field = await screen.findByLabelText('Перевод')
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
}

describe('Workspace: list', () => {
  it('loads the deck and the first page of words', async () => {
    await open()
    expect(screen.getByText('основа r1')).toBeTruthy()
    expect(bodyRows()).toHaveLength(50)
    expect(screen.getByText('Загружено 50 из 120')).toBeTruthy()
    expect(rowOf('ba')).toBeTruthy()
    expect(bar()).toBeNull()
  })

  it('shows more rows with the next-page button', async () => {
    const fake = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await screen.findByText('Загружено 100 из 120')
    expect(bodyRows()).toHaveLength(100)
    expect(fake.callsOf('cards').map((args) => (args[0] as { offset?: number }).offset)).toEqual([0, 50])
  })

  it('searches on the server after a short pause', async () => {
    const fake = await open()
    const word = fake.card(201).word
    const before = fake.callsOf('cards').length
    fireEvent.change(search(), { target: { value: word } })
    expect(fake.callsOf('cards')).toHaveLength(before)
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(fake.callsOf('cards').at(-1)?.[0]).toMatchObject({ q: word, state: 'active' })
  })

  it('filters by part of speech and by state', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Глаг.' }))
    await screen.findByText('Загружено 30 из 30')
    expect(within(bodyRows()[0]).getByText('глагол')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Глаг.', pressed: true })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Состояние' }), { target: { value: 'incomplete' } })
    await screen.findByText('Загружено 40 из 40')
  })

  it('shows archived cards with a restore button', async () => {
    await open({ before: (fake) => fake.archiveCard(102) })
    fireEvent.change(screen.getByRole('combobox', { name: 'Состояние' }), { target: { value: 'archived' } })
    await screen.findByText('Загружено 1 из 1')
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть «ko» из архива' }))
    expect(await screen.findByText('«ko» вернётся из архива')).toBeTruthy()
    expect(bodyRows()).toHaveLength(0)
    expect(bar()?.textContent).toContain('1 из архива')
  })

  it('shows a load error and loads the list again on retry', async () => {
    const fake = createFakeApi({ cards: seedCards(120) })
    fake.failNext('cards', { kind: 'network' })
    render(<Workspace api={fake.api} pollMs={600_000} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Не удалось загрузить список: Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(50))
  })

  it('shows a deck load error and retries', async () => {
    const fake = createFakeApi({ cards: seedCards(120) })
    fake.failNext('deck', { kind: 'network' })
    render(<Workspace api={fake.api} pollMs={600_000} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Слова' })
  })

  it('focuses the search field on "/" but not while typing', async () => {
    await open()
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false)
    expect(document.activeElement).toBe(search())
    const field = screen.getByRole('combobox', { name: 'Состояние' })
    field.focus()
    expect(fireEvent.keyDown(field, { key: '/' })).toBe(true)
    expect(document.activeElement).toBe(field)
  })
})

describe('Workspace: editing', () => {
  it('opens a card from the keyboard, closes with Esc and returns focus to the row', async () => {
    const fake = await open()
    const row = rowOf('ba')
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    const panel = await editor()
    expect(row.getAttribute('aria-current')).toBe('true')
    await screen.findByLabelText('Слово')
    expect(fake.callsOf('card').map((args) => args[0])).toEqual([101])
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull())
    expect(document.activeElement).toBe(row)
  })

  it('puts an edit into the draft and shows it in the row, the bar and storage', async () => {
    await open()
    rowOf('ba').focus()
    await editTranslation('ba', 'новый перевод')
    await screen.findByText('Правки «ba» в черновике · основа v1')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull())

    const row = rowOf('ba')
    expect(within(row).getByText('новый перевод')).toBeTruthy()
    expect(within(row).getByText('Изменено')).toBeTruthy()
    expect(within(row).getByText('v1 → v2')).toBeTruthy()
    expect(bar()?.textContent).toContain('1 изменено')
    expect(bar()?.textContent).toContain('основан на ревизии r1 · сохранится как r2')
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(document.activeElement).toBe(row)
  })

  it('reopens a changed card from the draft with the change highlighted', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull())
    const reads = fake.callsOf('card').length

    fireEvent.click(rowOf('ba'))
    const field = (await screen.findByLabelText('Перевод')) as HTMLInputElement
    expect(field.value).toBe('новый перевод')
    expect(document.querySelectorAll('.chg')).toHaveLength(1)
    expect(fake.callsOf('card')).toHaveLength(reads)
  })

  it('adds a new word to the top of the list', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Новое слово' }))
    await editor()
    fireEvent.change(screen.getByLabelText('Слово'), { target: { value: 'fresh' } })
    fireEvent.change(screen.getByLabelText('Перевод'), { target: { value: 'свежий' } })
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }))
    await screen.findByText('«fresh» добавлено в черновик')

    expect(bar()?.textContent).toContain('1 новых')
    const top = bodyRows()[0]
    expect(within(top).getByText('fresh')).toBeTruthy()
    expect(within(top).getByText('Новое')).toBeTruthy()
    expect(within(top).getByText('—')).toBeTruthy()
  })

  it('archives a card in the draft and cancels everything with a second press', async () => {
    await open()
    fireEvent.click(rowOf('ko'))
    await screen.findByLabelText('Слово')
    fireEvent.click(screen.getByRole('button', { name: 'В архив' }))
    await screen.findByText('«ko» уйдёт в архив при сохранении')
    expect(within(rowOf('ko')).getByText('В архив')).toBeTruthy()
    expect(bar()?.textContent).toContain('1 в архив')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить всё' }))
    expect(bar()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Да, отменить всё' }))
    expect(bar()).toBeNull()
    expect(within(rowOf('ko')).getByText('Опубликовано')).toBeTruthy()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('shows only draft rows under the draft filter without asking the server', async () => {
    const fake = await open()
    await editTranslation('ba', 'новый перевод')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Редактор карточки' })).toBeNull())
    const calls = fake.callsOf('cards').length
    fireEvent.change(screen.getByRole('combobox', { name: 'Состояние' }), { target: { value: 'draft' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(within(bodyRows()[0]).getByText('ba')).toBeTruthy()
    expect(fake.callsOf('cards')).toHaveLength(calls)
  })
})

describe('Workspace: draft storage', () => {
  it('restores a saved draft after a reload', async () => {
    const saved = emptyDraft(1, 1)
    saved.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'kept', translation: 'сохранённое', pos: 'noun' }) }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(saved))
    await open()
    expect(bar()?.textContent).toContain('1 новых')
    expect(within(bodyRows()[0]).getByText('kept')).toBeTruthy()
  })

  it('asks the browser to confirm closing the tab only while there is a draft', async () => {
    await open()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await editTranslation('ba', 'новый перевод')
    await screen.findByText('Правки «ba» в черновике · основа v1')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('Workspace: server moved ahead', () => {
  it('shows no banner for an empty draft, even when the deck changes', async () => {
    const fake = await open({ pollMs: 40 })
    fake.editCard(105, { usage: 'С сервера' })
    await screen.findByText('основа r2')
    expect(screen.queryByText(/Колода обновилась/)).toBeNull()
  })

  it('offers to update the base and merges the server change into the draft', async () => {
    const fake = await open({ pollMs: 40 })
    await editTranslation('ba', 'моя правка')
    await screen.findByText('Правки «ba» в черновике · основа v1')

    fake.editCard(101, { usage: 'С сервера' })
    const banner = await screen.findByText(/Колода обновилась до/)
    expect(banner.textContent).toContain('r2')
    expect(screen.getByText('основа r1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Обновить основу' }))
    await screen.findByText('Основа обновлена до r2 · с сервера подтянуто полей: 1')
    await waitFor(() => expect(screen.queryByText(/Колода обновилась до/)).toBeNull())
    expect(screen.getByText('основа r2')).toBeTruthy()

    fireEvent.click(rowOf('ba'))
    expect(((await screen.findByLabelText('Перевод')) as HTMLInputElement).value).toBe('моя правка')
    expect((screen.getByLabelText('Контекст и стиль') as HTMLTextAreaElement).value).toBe('С сервера')
    expect(document.querySelectorAll('.chg')).toHaveLength(1)
  })

  it('reports a conflict, keeps the draft and the old base', async () => {
    const fake = await open({ pollMs: 40 })
    await editTranslation('ba', 'моя правка')
    await screen.findByText('Правки «ba» в черновике · основа v1')

    fake.editCard(101, { translation: 'серверная правка' })
    await screen.findByText(/Колода обновилась до/)
    fireEvent.click(screen.getByRole('button', { name: 'Обновить основу' }))
    await screen.findByText(/Изменения пересекаются с серверными в карточках: ba/)
    expect(screen.getByText('основа r1')).toBeTruthy()
    expect(bar()?.textContent).toContain('1 изменено')
    expect(within(rowOf('ba')).getByText('моя правка')).toBeTruthy()
  })
})

describe('Workspace: upload from JSON', () => {
  const withWhere = (fake: FakeApi) => void fake.addCard({ word: 'where', pos: 'adv', translation: 'где, куда' })
  const dialog = () => screen.queryByRole('dialog', { name: 'Загрузка слов из JSON' })
  const importButton = () => screen.getByRole('button', { name: 'Загрузить JSON' })
  const group = () => screen.queryAllByRole('row').find((row) => row.className === 'grp')

  async function addSample() {
    fireEvent.click(importButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Использовать пример файла' }))
    await screen.findByText(/Проверено сервером/)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить 7 в черновик' }))
  }

  it('opens from the header, closes with Esc and gives the focus back to the button', async () => {
    await open()
    importButton().focus()
    fireEvent.click(importButton())
    expect(dialog()).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(importButton())
  })

  it('puts the valid rows into the draft: a group row, the draft bar, the message and the storage', async () => {
    await open({ before: withWhere })
    await addSample()
    expect(dialog()).toBeNull()
    expect(group()?.textContent).toBe('Из файла · travel-words.json · 7 новых словУбрать')
    expect(bar()?.textContent).toContain('7 из файла')
    expect(await screen.findByText('Из файла «travel-words.json» в черновик добавлено: 7')).toBeTruthy()
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}')
    expect(stored.imports).toHaveLength(1)
    expect(stored.imports[0]).toMatchObject({ fileName: 'travel-words.json', preview: { added: 7, skipped: 1, errors: 3 } })
    expect(stored.imports[0].cards).toHaveLength(7)
  })

  it('takes the file out of the draft with «Убрать»', async () => {
    await open({ before: withWhere })
    await addSample()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать файл travel-words.json из черновика' }))
    expect(group()).toBeUndefined()
    expect(bar()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(await screen.findByText('Файл «travel-words.json» убран из черновика')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Слова' }))
  })

  it('shows the file under the draft filter without asking the server for the list', async () => {
    const fake = await open({ before: withWhere })
    await addSample()
    const calls = fake.callsOf('cards').length
    fireEvent.change(screen.getByRole('combobox', { name: 'Состояние' }), { target: { value: 'draft' } })
    await waitFor(() => expect(group()).toBeTruthy())
    expect(bodyRows()).toHaveLength(1)
    expect(screen.queryByText('В черновике пока ничего нет')).toBeNull()
    expect(fake.callsOf('cards')).toHaveLength(calls)
  })

  it('hides the group while searching and brings it back afterwards', async () => {
    await open({ before: withWhere })
    await addSample()
    fireEvent.change(search(), { target: { value: 'ba' } })
    await waitFor(() => expect(group()).toBeUndefined())
    fireEvent.change(search(), { target: { value: '' } })
    await waitFor(() => expect(group()).toBeTruthy())
  })

  it('keeps the file in the draft after a reload', async () => {
    const saved = emptyDraft(1, 1)
    saved.imports.push({ fileName: 'kept.json', cards: [makeCard({ word: 'kept', translation: 'сохранённое', pos: 'noun' })], preview: { added: 1, skipped: 0, errors: 0 } })
    localStorage.setItem(DRAFT_KEY, JSON.stringify(saved))
    await open()
    expect(group()?.textContent).toBe('Из файла · kept.json · 1 новое словоУбрать')
    expect(bar()?.textContent).toContain('1 из файла')
  })

  it('does not take the «/» key from the dialog to the search field', async () => {
    await open()
    fireEvent.click(importButton())
    const dialogEl = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialogEl)
    expect(fireEvent.keyDown(dialogEl, { key: '/' })).toBe(true)
    expect(document.activeElement).toBe(dialogEl)
  })

  it('warns once when the draft no longer fits into the browser storage', async () => {
    await open()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      await editTranslation('ba', 'новый перевод')
      expect(await screen.findByText(/Черновик не помещается в память браузера/)).toBeTruthy()
      expect(screen.getAllByText(/Черновик не помещается в память браузера/)).toHaveLength(1)
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
