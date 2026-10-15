import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FakeApi, createFakeApi, seedCards } from '../fakeApi'
import { makeCard } from '../testkit'
import type { DeckInfo } from '../types'
import { HistoryView } from './HistoryView'

afterEach(cleanup)

function deckOf(fake: FakeApi): DeckInfo {
  return { id: 1, slug: 'default', title: 'Default', revision: fake.revision(), activeCards: 10, archivedCards: 0 }
}

interface Setup {
  cards?: number
  edits?: number
  exporting?: number | 'current' | null
  reverting?: number | null
}

function setup(options: Setup = {}) {
  const fake = createFakeApi({ cards: seedCards(options.cards ?? 10), revision: 1 })
  for (let i = 0; i < (options.edits ?? 0); i++) fake.editCard(101, { translation: `правка ${i + 1}` })
  const handlers = {
    onExport: vi.fn<(revision: number) => void>(),
    onRevert: vi.fn<(revision: number) => void>(),
    onOpenVersion: vi.fn<(cardId: number, version: number) => void>(),
  }
  const ui = (deck: DeckInfo) => (
    <HistoryView api={fake.api} deck={deck} exporting={options.exporting ?? null} reverting={options.reverting ?? null} {...handlers} />
  )
  const view = render(ui(deckOf(fake)))
  return { fake, ...handlers, rerenderFor: () => view.rerender(ui(deckOf(fake))) }
}

async function timeline() {
  let list: HTMLElement | null = null
  await waitFor(() => {
    list = screen.getByRole('list', { name: 'Ревизии, новые сверху' })
    expect(list.children.length).toBeGreaterThan(0)
  })
  return list as unknown as HTMLElement
}

const itemsOf = (list: HTMLElement) => Array.from(list.children) as HTMLElement[]

describe('HistoryView: the list', () => {
  it('lists revisions newest first with title, author, base, and marks only the top one as current', async () => {
    setup({ edits: 2 })
    const items = itemsOf(await timeline())
    expect(items.map((item) => item.querySelector('.r')?.textContent)).toEqual(['r3', 'r2', 'r1'])

    const [top, middle, first] = items
    expect(top.textContent).toContain('Правки карточек')
    expect(top.textContent).toContain('Вы')
    expect(top.textContent).toContain('основа r2')
    expect(within(top).getByText('текущая')).toBeTruthy()
    expect(within(middle).queryByText('текущая')).toBeNull()

    expect(first.textContent).toContain('Начальная загрузка из data/cards.json')
    expect(first.textContent).toContain('система')
    expect(first.textContent).toContain('первая ревизия')
    expect(within(first).getByText('+10')).toBeTruthy()
    expect(within(top).getByText('~1')).toBeTruthy()
    expect(within(top).queryByText(/^\+/)).toBeNull()
  })

  it('shows the comment, the imported files and the badges of a saved revision', async () => {
    const fake = createFakeApi({ cards: seedCards(10), revision: 1 })
    const saved = await fake.api.save({
      baseRevision: 1,
      create: [],
      update: [],
      archive: [{ id: 103, baseVersion: fake.card(103).version }],
      restore: [],
      imports: [{ fileName: 'travel.json', cards: [makeCard({ word: 'luggage', pos: 'noun', translation: 'багаж' }), makeCard({ word: 'board', pos: 'verb', translation: 'садиться' })] }],
    })
    expect(saved.ok).toBe(true)
    render(<HistoryView api={fake.api} deck={deckOf(fake)} exporting={null} reverting={null} onExport={vi.fn()} onRevert={vi.fn()} onOpenVersion={vi.fn()} />)

    const [top] = itemsOf(await timeline())
    expect(top.textContent).toContain('Импорт: travel.json и правки')
    expect(within(top).getByRole('list', { name: 'Загруженные файлы' }).textContent).toBe('travel.json · +2')
    expect(within(top).getByText('+2')).toBeTruthy()
    expect(within(top).getByText('−1')).toBeTruthy()
  })

  it('loads 30 at a time, says how many of all are on screen and fetches the older ones on request', async () => {
    const { fake } = setup({ edits: 34 })
    const list = await timeline()
    expect(itemsOf(list)).toHaveLength(30)
    expect(screen.getByText('Загружено 30 из 35')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(itemsOf(list)).toHaveLength(35))
    expect(screen.getByText('Загружено 35 из 35')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull()
    expect(itemsOf(list).map((item) => item.querySelector('.r')?.textContent).slice(-2)).toEqual(['r2', 'r1'])
    expect(fake.callsOf('revisions').map((args) => args[0])).toEqual([{ limit: 30 }, { limit: 30, before: 6 }])
  })

  it('does not offer more when the oldest revision is on screen', async () => {
    setup({ edits: 2 })
    await timeline()
    expect(screen.getByText('Загружено 3 из 3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull()
  })

  it('picks up a revision that appeared after the list was opened and moves «текущая» to it', async () => {
    const { fake, rerenderFor } = setup({ edits: 1 })
    const list = await timeline()
    expect(itemsOf(list)).toHaveLength(2)

    fake.editCard(102, { translation: 'другое' })
    rerenderFor()
    await waitFor(() => expect(itemsOf(list)).toHaveLength(3))
    const [top, second] = itemsOf(list)
    expect(top.querySelector('.r')?.textContent).toBe('r3')
    expect(within(top).getByText('текущая')).toBeTruthy()
    expect(within(second).queryByText('текущая')).toBeNull()
  })

  it('says why the list did not load and tries again', async () => {
    const fake = createFakeApi({ cards: seedCards(10), revision: 1 })
    fake.failNext('revisions', { kind: 'network' })
    render(<HistoryView api={fake.api} deck={deckOf(fake)} exporting={null} reverting={null} onExport={vi.fn()} onRevert={vi.fn()} onOpenVersion={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось загрузить ленту: Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(itemsOf(await timeline())).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('HistoryView: cards of a revision', () => {
  it('opens a revision, lists what it changed and links to the version of the card', async () => {
    const { fake, onOpenVersion } = setup({ edits: 1 })
    await timeline()
    const toggle = screen.getByRole('button', { name: 'Показать карточки r2' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const changes = await screen.findByRole('list', { name: 'Карточки r2' })
    const [row] = within(changes).getAllByRole('listitem')
    expect(row.textContent).toContain('Изменена')
    expect(row.textContent).toContain('ba')
    expect(row.textContent).toContain('правка 1')
    expect(screen.getByText('1 карточка')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: 'Открыть версию v2 карточки «ba»' }))
    expect(onOpenVersion).toHaveBeenCalledWith(101, 2)

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть карточки r2' }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Показать карточки r2' }))
    expect(fake.callsOf('revision')).toHaveLength(1)
  })

  it('names the kind of change of every card: new, changed, archived, brought back', async () => {
    const { fake } = setup({ cards: 10 })
    fake.addCard({ word: 'fresh', translation: 'свежее' })
    fake.editCard(101, { translation: 'иначе' })
    fake.archiveCard(102)
    cleanup()
    render(<HistoryView api={fake.api} deck={deckOf(fake)} exporting={null} reverting={null} onExport={vi.fn()} onRevert={vi.fn()} onOpenVersion={vi.fn()} />)
    await timeline()
    for (const [rev, kind] of [[2, 'Новая'], [3, 'Изменена'], [4, 'В архив']] as const) {
      fireEvent.click(screen.getByRole('button', { name: `Показать карточки r${rev}` }))
      const list = await screen.findByRole('list', { name: `Карточки r${rev}` })
      expect(within(list).getByText(kind)).toBeTruthy()
    }
  })

  it('shows the first 100 cards of a big revision and the rest on request', async () => {
    setup({ cards: 130 })
    await timeline()
    fireEvent.click(screen.getByRole('button', { name: 'Показать карточки r1' }))
    const list = await screen.findByRole('list', { name: 'Карточки r1' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(100)
    expect(screen.getByText('130 карточек')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё (осталось 30)' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(130)
    expect(screen.queryByRole('button', { name: /Показать ещё \(осталось/ })).toBeNull()
  })

  it('says why the cards did not load and tries again', async () => {
    const { fake } = setup({ edits: 1 })
    await timeline()
    fake.failNext('revision', { kind: 'network' })
    fireEvent.click(screen.getByRole('button', { name: 'Показать карточки r2' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось загрузить карточки: Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('list', { name: 'Карточки r2' })).toBeTruthy()
  })
})

describe('HistoryView: export and revert', () => {
  it('exports any revision and offers a revert to every revision except the current one', async () => {
    const { onExport, onRevert } = setup({ edits: 2 })
    await timeline()
    expect(screen.queryByRole('button', { name: 'Откатить к r3' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Экспорт r3' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт r2' }))
    expect(onExport).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r1' }))
    expect(onRevert).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Откатить к r2' }))
    expect(onRevert).toHaveBeenLastCalledWith(2)
  })

  it('shows which export is running and blocks the others', async () => {
    setup({ edits: 2, exporting: 2 })
    await timeline()
    const running = screen.getByRole('button', { name: 'Экспорт r2' }) as HTMLButtonElement
    expect(running.textContent).toBe('Скачиваю…')
    for (const name of ['Экспорт r1', 'Экспорт r2', 'Экспорт r3']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows which revert is being prepared and blocks the others', async () => {
    setup({ edits: 2, reverting: 1 })
    await timeline()
    expect(screen.getByRole('button', { name: 'Собираю…' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Откатить к r2' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
