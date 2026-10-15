import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminApi, ApiError } from '../api/admin'
import { type Draft, type DraftImport, emptyDraft } from '../draft/draft'
import { type FakeApi, createFakeApi } from '../fakeApi'
import { LIST_LIMIT, SAMPLE_FILE_NAME, SAMPLE_TEXT } from '../importFlow'
import { makeCard, makeServerCard } from '../testkit'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '../validate/rules'
import { ImportDialog } from './ImportDialog'

afterEach(cleanup)

const DECK = [
  makeServerCard(1, 1, { word: 'where', translation: 'где, куда', pos: 'adv', example: '', exampleHighlight: '', exampleTranslation: '' }),
  makeServerCard(2, 1, { word: 'when' }),
]

function setup(options: { draft?: Draft; fake?: FakeApi; api?: AdminApi } = {}) {
  const fake = options.fake ?? createFakeApi({ cards: DECK })
  const onAdd = vi.fn<(file: DraftImport) => void>()
  const onClose = vi.fn<() => void>()
  const save = vi.fn<(fileName: string, text: string) => void>()
  render(<ImportDialog api={options.api ?? fake.api} draft={options.draft ?? emptyDraft(1, 5)} onAdd={onAdd} onClose={onClose} save={save} />)
  return { fake, onAdd, onClose, save }
}

const file = (text: string, name = 'words.json') => new File([text], name, { type: 'application/json' })
const chooser = () => screen.getByLabelText('Выбрать файл') as HTMLInputElement
const choose = (text: string, name?: string) => fireEvent.change(chooser(), { target: { files: [file(text, name)] } })
const useSample = () => fireEvent.click(screen.getByRole('button', { name: 'Использовать пример файла' }))
const count = (label: string) => Number(screen.getByText(label).previousElementSibling?.textContent)
const counters = () => [count('будут добавлены'), count('уже есть — пропуск'), count('с ошибками')]
const addButton = () => screen.getByRole('button', { name: /^(Добавить|Проверяю)/ }) as HTMLButtonElement
const rowsOf = (words: string[]) => words.map((word) => ({ word, pos: 'noun', translation: `перевод ${word}` }))
const checked = () => screen.findByText(/Проверено сервером/)
const counted = () => screen.findByRole('group', { name: 'Результат проверки' })

describe('ImportDialog: first look', () => {
  it('is a dialog with a drop zone, a file chooser for .json and the sample button; nothing can be added yet', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Загрузка слов из JSON' })).toBeTruthy()
    expect(screen.getByText('Перетащите файл .json сюда')).toBeTruthy()
    expect(chooser().getAttribute('accept')).toBe('.json,application/json')
    expect(screen.getByText('До 4 МБ и 5000 карточек')).toBeTruthy()
    expect(addButton().textContent).toBe('Добавить в черновик')
    expect(addButton().disabled).toBe(true)
    expect(screen.queryByRole('group', { name: 'Результат проверки' })).toBeNull()
  })

  it('closes with Отмена', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ImportDialog: the mockup scenario', () => {
  it('«Использовать пример файла» gives 7 added / 1 already there / 3 with errors', async () => {
    setup()
    useSample()
    await checked()
    expect(counters()).toEqual([7, 1, 3])
    expect(screen.getByText('travel-words.json')).toBeTruthy()
    expect(screen.getByText(/11 записей/)).toBeTruthy()
    expect(addButton().textContent).toBe('Добавить 7 в черновик')
    expect(addButton().disabled).toBe(false)
    expect(screen.getByText('Проверено: будут добавлены 7, уже есть 1, с ошибками 3.')).toBeTruthy()
  })

  it('a file from the chooser gives the same result', async () => {
    const { fake } = setup()
    choose(SAMPLE_TEXT, 'travel-words.json')
    await checked()
    expect(counters()).toEqual([7, 1, 3])
    expect(fake.callsOf('exportCurrent')).toHaveLength(1)
  })

  it('lists every row with an error: row number, word and the reason', async () => {
    setup()
    useSample()
    await checked()
    const list = within(screen.getByRole('region', { name: 'Строки с ошибками' }))
    const items = list.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('строка 9')
    expect(items[0]).toContain('гостиница')
    expect(items[0]).toContain('Слово: Только латиница')
    expect(items[1]).toContain('строка 10')
    expect(items[1]).toContain('Часть речи: Допустимо')
    expect(items[2]).toContain('строка 11')
    expect(items[2]).toContain('Выделить: Не найдено в предложении')
  })

  it('names the duplicate and where it was found', async () => {
    setup()
    useSample()
    await checked()
    const details = screen.getByText('Пропущено как дубли: 1').closest('details') as HTMLElement
    expect(within(details).getAllByRole('listitem')[0].textContent).toBe('строка 8whereв колоде')
  })

  it('asks the server about this file only and sends only the rows that passed', async () => {
    const { fake } = setup()
    useSample()
    await checked()
    const [body] = fake.callsOf('validate')[0] as [{ baseRevision: number; imports: { fileName: string; cards: { word: string }[] }[]; create?: unknown; update?: unknown }]
    expect(body.baseRevision).toBe(5)
    expect(Object.keys(body).sort()).toEqual(['baseRevision', 'imports'])
    expect(body.imports).toHaveLength(1)
    expect(body.imports[0].fileName).toBe(SAMPLE_FILE_NAME)
    expect(body.imports[0].cards.map((c) => c.word)).toEqual(['luggage', 'board', 'delay', 'departure', 'arrive', 'check-in', 'window seat'])
  })
})

describe('ImportDialog: files that cannot be used', () => {
  const cases: [string, string, string][] = [
    ['broken JSON', '{"word": ', 'Файл не прочитан: это не JSON'],
    ['an object instead of an array', '{"word":"a","pos":"noun","translation":"б"}', 'Ожидался массив карточек, как в data/cards.json'],
    ['an empty array', '[]', 'В файле нет карточек'],
    ['more rows than allowed', JSON.stringify(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ word: `w${i}`, pos: 'noun', translation: 'х' }))), `В файле больше ${MAX_IMPORT_ROWS} карточек`],
  ]
  for (const [name, text, message] of cases) {
    it(`says so for ${name}, shows no counters and does not ask the server`, async () => {
      const { fake } = setup()
      choose(text)
      expect((await screen.findByRole('alert')).textContent).toBe(message)
      expect(screen.queryByRole('group', { name: 'Результат проверки' })).toBeNull()
      expect(addButton().disabled).toBe(true)
      expect(fake.callsOf('validate')).toHaveLength(0)
    })
  }

  it('rejects a file over 4 MB by its size, without reading it', async () => {
    const { fake } = setup()
    const big = file('[]', 'big.json')
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 })
    Object.defineProperty(big, 'text', {
      value: () => {
        throw new Error('the file must not be read')
      },
    })
    fireEvent.change(chooser(), { target: { files: [big] } })
    expect((await screen.findByRole('alert')).textContent).toBe('Файл больше 4 МБ')
    expect(fake.callsOf('validate')).toHaveLength(0)
  })

  it('a file whose rows are all broken has nothing to add and is not sent to the server', async () => {
    const { fake } = setup()
    choose(JSON.stringify([{ word: 'не слово', pos: 'noun', translation: 'х' }, 5]))
    await counted()
    expect(counters()).toEqual([0, 0, 2])
    expect(addButton().disabled).toBe(true)
    expect(fake.callsOf('validate')).toHaveLength(0)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('строка 2—Строка должна быть объектом')
  })
})

describe('ImportDialog: duplicates', () => {
  it('against the deck, the draft and inside the file', async () => {
    const draft: Draft = {
      ...emptyDraft(1, 5),
      items: { 'tmp-1': { kind: 'create', card: makeCard({ word: 'newcard', pos: 'noun', translation: 'новая' }) } },
      imports: [{ fileName: 'earlier.json', cards: [makeCard({ word: 'earlier', pos: 'noun', translation: 'раньше' })], preview: { added: 1, skipped: 0, errors: 0 } }],
    }
    setup({ draft })
    choose(
      JSON.stringify([
        { word: 'where', pos: 'adv', translation: 'где, куда' },
        { word: 'NewCard', pos: 'noun', translation: 'новая' },
        { word: 'earlier', pos: 'noun', translation: 'раньше' },
        { word: 'fresh', pos: 'noun', translation: 'свежее' },
        { word: 'Fresh', pos: 'noun', translation: 'свежее' },
      ]),
    )
    await checked()
    expect(counters()).toEqual([1, 4, 0])
    const details = screen.getByText('Пропущено как дубли: 4').closest('details') as HTMLElement
    expect(within(details).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'строка 1whereв колоде',
      'строка 2NewCardв черновике',
      'строка 3earlierв черновике',
      'строка 5Freshповтор в файле',
    ])
  })

  it('a card that the draft sends to the archive can be uploaded again', async () => {
    const draft: Draft = { ...emptyDraft(1, 5), items: { '1': { kind: 'archive', baseVersion: 1, base: makeCard({ word: 'where', pos: 'adv', translation: 'где, куда' }) } } }
    setup({ draft })
    useSample()
    await checked()
    expect(counters()).toEqual([8, 0, 3])
  })

  it('the same file twice: a warning, and every row is a duplicate', async () => {
    const first = setup()
    useSample()
    await checked()
    fireEvent.click(addButton())
    const added = first.onAdd.mock.calls[0][0]
    cleanup()

    setup({ draft: { ...emptyDraft(1, 5), imports: [added] } })
    useSample()
    await counted()
    expect(screen.getByText(/уже добавлен в черновик/)).toBeTruthy()
    expect(counters()).toEqual([0, 8, 3])
    expect(addButton().disabled).toBe(true)
  })

  it('does not warn about a file name that is not in the draft', async () => {
    setup()
    useSample()
    await checked()
    expect(screen.queryByText(/уже добавлен в черновик/)).toBeNull()
  })
})

describe('ImportDialog: the server has the last word', () => {
  it('finds a duplicate that appeared after the deck was read, and says the deck changed', async () => {
    const { fake } = setup()
    await waitFor(() => expect(fake.callsOf('exportCurrent')).toHaveLength(1))
    fake.addCard({ word: 'delay', pos: 'noun', translation: 'задержка' })
    useSample()
    expect((await screen.findByText(/колода изменилась/)).textContent).toBe('Проверено сервером · колода изменилась, сервер нашёл дублей ещё: 1')
    expect(counters()).toEqual([6, 2, 3])
    expect(addButton().textContent).toBe('Добавить 6 в черновик')
    const details = screen.getByText('Пропущено как дубли: 2').closest('details') as HTMLElement
    expect(within(details).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['строка 3delayв колоде', 'строка 8whereв колоде'])
  })

  it('works out the duplicates itself when the deck could not be loaded', async () => {
    const fake = createFakeApi({ cards: DECK })
    fake.failNext('exportCurrent', { kind: 'network' })
    setup({ fake })
    useSample()
    await checked()
    expect(counters()).toEqual([7, 1, 3])
    expect(screen.queryByText('проверено локально')).toBeNull()
  })

  it('moves a row the server refused into the rows with errors', async () => {
    const fake = createFakeApi({ cards: DECK })
    fake.failNext('validate', {
      kind: 'validation',
      code: 'invalid_argument',
      message: 'bad',
      errors: [{ section: 'imports', index: 1, file: SAMPLE_FILE_NAME, field: 'translation', code: 'required', message: 'must be provided' }],
    })
    setup({ fake })
    useSample()
    await checked()
    expect(counters()).toEqual([6, 1, 4])
    const list = within(screen.getByRole('region', { name: 'Строки с ошибками' }))
    expect(list.getAllByRole('listitem')[0].textContent).toBe('строка 2boardПеревод: Обязательное поле')
  })

  it('refuses to add when the server does not accept the file as a whole', async () => {
    const fake = createFakeApi({ cards: DECK })
    fake.failNext('validate', {
      kind: 'validation',
      code: 'invalid_argument',
      message: 'Сервер не принял данные.',
      errors: [{ section: 'imports', index: 0, code: 'invalid_file_name', message: 'fileName must be 1 to 200 characters' }],
    })
    setup({ fake })
    useSample()
    expect((await screen.findByText('Сервер не принял файл: Сервер не принял данные.')).textContent).toBeTruthy()
    expect(addButton().disabled).toBe(true)
  })

  for (const error of [{ kind: 'network' }, { kind: 'server', status: 502, message: '' }] as ApiError[]) {
    it(`shows the local result with the mark «проверено локально» when the server answers: ${error.kind}`, async () => {
      const fake = createFakeApi({ cards: DECK })
      fake.failNext('validate', error)
      const { onAdd } = setup({ fake })
      useSample()
      expect((await screen.findByText('проверено локально')).textContent).toBe('проверено локально')
      expect(screen.queryByText(/Проверено сервером/)).toBeNull()
      expect(counters()).toEqual([7, 1, 3])
      expect(addButton().disabled).toBe(false)
      fireEvent.click(addButton())
      expect(onAdd).toHaveBeenCalledTimes(1)
    })
  }

  it('does not allow adding while the server is still checking', async () => {
    const fake = createFakeApi({ cards: DECK })
    const api = { ...fake.api, validate: () => new Promise<never>(() => undefined) } as unknown as AdminApi
    const { onAdd } = setup({ fake, api })
    useSample()
    expect((await screen.findByText('Сверяю с сервером…')).textContent).toBeTruthy()
    expect(counters()).toEqual([7, 1, 3])
    expect(addButton().textContent).toBe('Проверяю…')
    expect(addButton().disabled).toBe(true)
    fireEvent.click(addButton())
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('forgets the answer for an older file when another one is chosen', async () => {
    const { fake } = setup()
    choose(JSON.stringify(rowsOf(['alpha', 'beta'])), 'first.json')
    await checked()
    expect(counters()).toEqual([2, 0, 0])
    choose(JSON.stringify(rowsOf(['gamma'])), 'second.json')
    await waitFor(() => expect(screen.getByText('second.json')).toBeTruthy())
    await checked()
    expect(counters()).toEqual([1, 0, 0])
    expect(screen.queryByText('first.json')).toBeNull()
    expect(fake.callsOf('validate')).toHaveLength(2)
  })
})

describe('ImportDialog: adding to the draft', () => {
  it('hands over only the valid rows, with the file name and the counters', async () => {
    const { onAdd } = setup()
    useSample()
    await checked()
    fireEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledTimes(1)
    const file = onAdd.mock.calls[0][0]
    expect(file.fileName).toBe('travel-words.json')
    expect(file.cards.map((c) => c.word)).toEqual(['luggage', 'board', 'delay', 'departure', 'arrive', 'check-in', 'window seat'])
    expect(file.preview).toEqual({ added: 7, skipped: 1, errors: 3 })
  })

  it('trims spaces and drops unknown fields, because the server accepts only the 11 fields', async () => {
    const { onAdd } = setup()
    choose(JSON.stringify([{ word: '  tidy  ', pos: 'noun', translation: ' чисто ', extra: 'x' }]))
    await checked()
    fireEvent.click(addButton())
    expect(Object.keys(onAdd.mock.calls[0][0].cards[0])).toHaveLength(11)
    expect(onAdd.mock.calls[0][0].cards[0]).toMatchObject({ word: 'tidy', translation: 'чисто' })
  })

  it('does not hand anything over when every row is skipped', async () => {
    const { onAdd } = setup()
    choose(JSON.stringify([{ word: 'where', pos: 'adv', translation: 'где, куда' }]))
    await counted()
    expect(counters()).toEqual([0, 1, 0])
    expect(addButton().disabled).toBe(true)
    fireEvent.click(addButton())
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('ImportDialog: the error report', () => {
  it('is offered only when there are errors', async () => {
    setup()
    choose(JSON.stringify(rowsOf(['alpha'])))
    await checked()
    expect(screen.queryByRole('button', { name: 'Скачать отчёт об ошибках' })).toBeNull()
  })

  it('downloads a JSON with the row numbers and the reasons', async () => {
    const { save } = setup()
    useSample()
    await checked()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать отчёт об ошибках' }))
    expect(save).toHaveBeenCalledTimes(1)
    const [name, text] = save.mock.calls[0]
    expect(name).toBe('travel-words-errors.json')
    const report = JSON.parse(text)
    expect(report).toMatchObject({ fileName: 'travel-words.json', rows: 11, willBeAdded: 7, checked: 'server' })
    expect(report.errors.map((e: { index: number; row: number; word: string }) => [e.index, e.row, e.word])).toEqual([
      [8, 9, 'гостиница'],
      [9, 10, 'passport'],
      [10, 11, 'ticket'],
    ])
    expect(report.errors[1].reasons[0]).toContain('pos:')
    expect(report.skipped).toEqual([{ index: 7, row: 8, word: 'where', reason: 'deck' }])
  })

  it('shows the first 100 errors, says how many more there are, and keeps all of them in the report', async () => {
    const rows = Array.from({ length: LIST_LIMIT + 50 }, (_, i) => ({ word: `bad ${i}!`, pos: 'noun', translation: 'х' }))
    const { save } = setup()
    choose(JSON.stringify([{ word: 'good', pos: 'noun', translation: 'хорошо' }, ...rows]))
    await checked()
    expect(counters()).toEqual([1, 0, LIST_LIMIT + 50])
    const list = within(screen.getByRole('region', { name: 'Строки с ошибками' }))
    expect(list.getAllByRole('listitem')).toHaveLength(LIST_LIMIT + 1)
    expect(list.getByText('…и ещё 50. Полный список в отчёте.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Скачать отчёт об ошибках' }))
    expect(JSON.parse(save.mock.calls[0][1]).errors).toHaveLength(LIST_LIMIT + 50)
  })

  it('marks the report as checked locally when the server did not answer', async () => {
    const fake = createFakeApi({ cards: DECK })
    fake.failNext('validate', { kind: 'network' })
    const { save } = setup({ fake })
    useSample()
    await screen.findByText('проверено локально')
    fireEvent.click(screen.getByRole('button', { name: 'Скачать отчёт об ошибках' }))
    expect(JSON.parse(save.mock.calls[0][1]).checked).toBe('local')
  })
})

describe('ImportDialog: drag and drop', () => {
  const zone = () => screen.getByText('Перетащите файл .json сюда').parentElement as HTMLElement

  it('highlights the zone while a file is over it and takes the dropped file', async () => {
    setup()
    expect(zone().className).toBe('drop')
    const dropped = file(SAMPLE_TEXT, 'travel-words.json')
    fireEvent.dragEnter(zone(), { dataTransfer: { files: [dropped] } })
    expect(zone().className).toBe('drop over')
    fireEvent.dragLeave(zone())
    expect(zone().className).toBe('drop')
    fireEvent.dragOver(zone(), { dataTransfer: { files: [dropped] } })
    expect(zone().className).toBe('drop over')

    fireEvent.drop(zone(), { dataTransfer: { files: [dropped] } })
    expect(zone().className).toBe('drop')
    await checked()
    expect(counters()).toEqual([7, 1, 3])
  })

  it('cancels the browser default, which would open the file in the tab', () => {
    setup()
    expect(fireEvent.dragOver(zone(), { dataTransfer: { files: [] } })).toBe(false)
    expect(fireEvent.drop(zone(), { dataTransfer: { files: [] } })).toBe(false)
  })

  it('ignores a drop without files', () => {
    setup()
    fireEvent.drop(zone(), { dataTransfer: { files: [] } })
    expect(screen.queryByRole('group', { name: 'Результат проверки' })).toBeNull()
  })

  it('clears the chooser after taking a file, so that the same file can be chosen again', () => {
    setup()
    const input = chooser()
    const writes: string[] = []
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: (value: string) => void writes.push(value) })
    fireEvent.change(input, { target: { files: [file('[]')] } })
    expect(writes).toEqual([''])
  })
})
