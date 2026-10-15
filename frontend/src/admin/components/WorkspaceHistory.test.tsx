import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY } from '../draft/storage'
import { type FakeApi, createFakeApi, seedCards } from '../fakeApi'
import Workspace from './Workspace'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

async function open(before?: (fake: FakeApi) => void) {
  const fake = createFakeApi({ cards: seedCards(60) })
  before?.(fake)
  const saveFile = vi.fn<(name: string, text: string) => void>()
  render(<Workspace api={fake.api} pollMs={600_000} saveFile={saveFile} />)
  await screen.findByRole('heading', { name: 'Слова' })
  await waitFor(() => expect(screen.queryAllByRole('row').length).toBeGreaterThan(1))
  return { fake, saveFile }
}

async function toHistory() {
  fireEvent.click(screen.getByRole('button', { name: /^История ревизий/ }))
  await screen.findByRole('heading', { name: 'История ревизий' })
  await waitFor(() => expect(screen.getByRole('list', { name: 'Ревизии, новые сверху' }).children.length).toBeGreaterThan(0))
}

const bar = () => screen.queryByRole('region', { name: 'Черновик' })
const toastText = () => document.querySelector('.toast-region')?.textContent ?? ''

async function editTranslation(word: string, value: string) {
  fireEvent.click(screen.getByRole('row', { name: new RegExp(`^${word} `) }))
  const input = await screen.findByLabelText('Перевод')
  await waitFor(() => expect((input as HTMLInputElement).value).not.toBe(''))
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  await screen.findByText(`Правки «${word}» в черновике · основа v1`)
}

describe('Workspace: export', () => {
  it('exports the current deck from the header of «Слова» and names the file after the revision the server gave', async () => {
    const { fake, saveFile } = await open((f) => f.editCard(101, { translation: 'на сервере' }))
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт текущей колоды' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const [name, text] = saveFile.mock.calls[0]
    expect(name).toBe(`engmark-r${fake.revision()}.json`)
    const cards = JSON.parse(text)
    expect(cards).toHaveLength(60)
    expect(cards[0]).toMatchObject({ word: 'ba', translation: 'на сервере' })
    expect(Object.keys(cards[0])).not.toContain('id')
    await waitFor(() => expect(toastText()).toContain('Скачан файл engmark-r2.json'))
  })

  it('reminds that the draft is not in the file', async () => {
    const { saveFile } = await open()
    await editTranslation('ba', 'черновой перевод')
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт текущей колоды' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFile.mock.calls[0][1]).not.toContain('черновой перевод')
    await waitFor(() => expect(toastText()).toContain('Черновик в файл не входит'))
  })

  it('exports an old revision from the history as it was then', async () => {
    const { saveFile } = await open((f) => {
      f.editCard(101, { translation: 'потом' })
      f.addCard({ word: 'later', translation: 'позже' })
    })
    await toHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт r1' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const [name, text] = saveFile.mock.calls[0]
    expect(name).toBe('engmark-r1.json')
    const cards = JSON.parse(text)
    expect(cards).toHaveLength(60)
    expect(cards[0].translation).toBe('перевод 1')
  })

  it('says so when the export fails', async () => {
    const { fake, saveFile } = await open()
    fake.failNext('exportCurrent', { kind: 'network' })
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт текущей колоды' }))
    await waitFor(() => expect(toastText()).toContain('Не удалось скачать: Нет связи с сервером.'))
    expect(saveFile).not.toHaveBeenCalled()
  })
})

describe('Workspace: revert through the draft', () => {
  it('builds a draft «Откат к r1», shows it in the words and saves it as an ordinary revision', async () => {
    const { fake } = await open((f) => {
      f.editCard(101, { translation: 'испорчено' })
      f.addCard({ word: 'later', translation: 'позже' })
    })
    await toHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))

    await screen.findByRole('heading', { name: 'Слова' })
    expect((screen.getByRole('combobox', { name: 'Состояние' }) as HTMLSelectElement).value).toBe('draft')
    await waitFor(() => expect(bar()?.textContent).toContain('«Откат к r1»'))
    expect(bar()?.textContent).toContain('1 изменено')
    expect(bar()?.textContent).toContain('1 в архив')
    expect(bar()?.textContent).toContain('основан на ревизии r3')
    expect(toastText()).toContain('Откат к r1 собран в черновик: изменено 1, уйдёт в архив 1')
    expect(fake.revision()).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    const dialog = await screen.findByRole('dialog', { name: 'Сохранить изменения' })
    expect((within(dialog).getByLabelText('Комментарий к ревизии') as HTMLInputElement).value).toBe('Откат к r1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Сохранено как r4. Каталог для учеников обновлён')
    expect(fake.card(101).translation).toBe('перевод 1')
    expect(fake.revisionLog()[0]).toMatchObject({ revision: 4, message: 'Откат к r1', updated: 1, archived: 1 })
    expect(bar()).toBeNull()
  })

  it('asks before replacing a draft with edits, and «Не откатывать» keeps it', async () => {
    const { fake } = await open((f) => f.editCard(102, { translation: 'испорчено' }))
    await editTranslation('ba', 'мой перевод')
    await toHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Откатить к r1?' })
    expect(dialog.textContent).toContain('1 несохранённая правка')
    expect(fake.callsOf('revertDraft')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Не откатывать' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('мой перевод')

    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Откатить к r1?' })).getByRole('button', { name: 'Отменить черновик и откатить' }))
    await waitFor(() => expect(bar()?.textContent).toContain('«Откат к r1»'))
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).not.toContain('мой перевод'))
    expect(screen.getByRole('row', { name: /^ko / })).toBeTruthy()
  })

  it('keeps the current draft when the revert could not be built', async () => {
    const { fake } = await open((f) => f.editCard(102, { translation: 'испорчено' }))
    await editTranslation('ba', 'мой перевод')
    await toHistory()
    fake.failNext('revertDraft', { kind: 'network' })
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Откатить к r1?' })).getByRole('button', { name: 'Отменить черновик и откатить' }))
    await waitFor(() => expect(toastText()).toContain('Не удалось собрать откат: Нет связи с сервером.'))
    expect(localStorage.getItem(DRAFT_KEY)).toContain('мой перевод')
    expect(bar()?.textContent).not.toContain('Откат')
  })

  it('says there is nothing to revert when the deck already matches', async () => {
    const { fake } = await open((f) => {
      f.editCard(101, { translation: 'временно' })
      f.editCard(101, { translation: 'перевод 1' })
    })
    await toHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))
    await waitFor(() => expect(toastText()).toContain('Колода уже совпадает с r1, откатывать нечего'))
    expect(bar()).toBeNull()
    expect(fake.revision()).toBe(3)
  })
})

describe('Workspace: from the history to a card version', () => {
  it('opens the card on the «Версии» tab at the version the link names', async () => {
    await open((f) => f.editCard(101, { translation: 'второй' }))
    await toHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Показать карточки r2' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть версию v2 карточки «ba»' }))

    await screen.findByRole('heading', { name: 'Слова' })
    const editor = await screen.findByRole('complementary', { name: 'Редактор карточки' })
    expect(within(editor).getByRole('tab', { name: 'Версии' }).getAttribute('aria-selected')).toBe('true')
    await within(editor).findByRole('list', { name: 'Версии карточки, новые сверху' })
    expect(within(editor).getByRole('button', { name: /^v2 / }).getAttribute('aria-expanded')).toBe('true')
  })
})
