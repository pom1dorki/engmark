import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type DraftImport, emptyDraft } from '../draft/draft'
import type { CardsState } from '../hooks/useCards'
import { type ListFilters, type Row, type StateFilter, buildRows, importGroups } from '../rows'
import { makeCard, makeServerCard } from '../testkit'
import type { ServerCard } from '../types'
import { WordsView } from './WordsView'

afterEach(cleanup)

const FILTERS: ListFilters = { q: '', pos: '', state: 'active' }

const CARDS: ServerCard[] = [
  makeServerCard(1, 1, { word: 'alpha', translation: 'альфа', pos: 'noun' }),
  makeServerCard(2, 2, { word: 'beta', translation: 'бета', pos: 'verb' }),
  makeServerCard(3, 1, { word: 'gamma', translation: 'гамма', pos: 'adj', archived: true, archivedAt: '2026-10-02T10:00:00Z' }),
]

function fileOf(fileName: string, count: number): DraftImport {
  const cards = Array.from({ length: count }, (_, i) => makeCard({ word: `imported${'abcdefghij'[i % 10]}`, translation: `слово ${i}` }))
  return { fileName, cards, preview: { added: count, skipped: 0, errors: 0 } }
}

function setup(
  props: {
    filters?: Partial<ListFilters>
    cards?: Partial<CardsState>
    items?: ServerCard[]
    selectedKey?: string | null
    imports?: DraftImport[]
    problems?: Record<string, string[]>
  } = {},
) {
  const filters = { ...FILTERS, ...props.filters }
  const items = props.items ?? CARDS
  const cards: CardsState = { items, total: items.length, loading: false, loadingMore: false, error: null, reload: vi.fn<() => void>(), loadMore: vi.fn<() => void>(), ...props.cards }
  const handlers = {
    onQueryText: vi.fn<(value: string) => void>(),
    onPos: vi.fn<(value: string) => void>(),
    onState: vi.fn<(value: StateFilter) => void>(),
    onOpen: vi.fn<(row: Row) => void>(),
    onRestore: vi.fn<(row: Row) => void>(),
    onRemoveImport: vi.fn<(index: number) => void>(),
  }
  const draft = { ...emptyDraft(1, 42), imports: props.imports ?? [] }
  const rows = buildRows(items, draft, filters)
  render(
    <WordsView
      filters={filters}
      queryText={filters.q}
      searchRef={{ current: null }}
      rows={rows}
      groups={importGroups(draft.imports, filters)}
      cards={cards}
      selectedKey={props.selectedKey ?? null}
      problems={props.problems ?? {}}
      {...handlers}
    />,
  )
  return { cards, ...handlers }
}

describe('WordsView: what the server did not accept', () => {
  it('marks the row, adds the tag and gives the reason to a screen reader', () => {
    setup({ problems: { '2': ['Слово: Только латиница, апостроф, дефис и одиночные пробелы'] } })
    const bad = screen.getByRole('row', { name: /beta/ })
    expect(bad.className).toContain('bad')
    expect(within(bad).getByText('Не принято')).toBeTruthy()
    expect(bad.textContent).toContain('Не принято: Слово: Только латиница, апостроф, дефис и одиночные пробелы')
    const fine = screen.getByRole('row', { name: /alpha/ })
    expect(fine.className).not.toContain('bad')
    expect(within(fine).queryByText('Не принято')).toBeNull()
  })

  it('names the reason next to the file row and keeps its «Убрать» button', () => {
    const { onRemoveImport } = setup({ imports: [fileOf('a.json', 2)], problems: { 'import:0': ['Строка 2. Слово: Обязательное поле'] } })
    const group = screen.getAllByRole('row').find((row) => row.className === 'grp') as HTMLElement
    expect(group.textContent).toContain('не принят сервером: Строка 2. Слово: Обязательное поле')
    fireEvent.click(within(group).getByRole('button', { name: 'Убрать файл a.json из черновика' }))
    expect(onRemoveImport).toHaveBeenCalledWith(0)
  })
})

describe('WordsView', () => {
  it('shows a row per card with part of speech, fill count and version', () => {
    setup()
    const row = screen.getByRole('row', { name: /alpha/ })
    expect(within(row).getByText('сущ.')).toBeTruthy()
    expect(within(row).getByText('альфа')).toBeTruthy()
    expect(within(row).getByText('6/11')).toBeTruthy()
    expect(within(row).getByText('v1')).toBeTruthy()
    expect(within(row).getByText('Опубликовано')).toBeTruthy()
    expect(screen.getByRole('row', { name: /beta/ })).toBeTruthy()
    expect(screen.queryByRole('row', { name: /gamma/ })).toBeNull()
  })

  it('opens a card on click, and on Enter or Space when the row itself has focus', () => {
    const { onOpen } = setup()
    const row = screen.getByRole('row', { name: /alpha/ })
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    fireEvent.keyDown(row, { key: 'a' })
    expect(onOpen).toHaveBeenCalledTimes(3)
    expect(onOpen.mock.calls[0][0].id).toBe(1)
  })

  it('marks the selected row for assistive technology', () => {
    setup({ selectedKey: '2' })
    expect(screen.getByRole('row', { name: /beta/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('row', { name: /alpha/ }).getAttribute('aria-current')).toBeNull()
  })

  it('restores an archived card with its own button without opening it', () => {
    const { onOpen, onRestore } = setup({ filters: { state: 'archived' } })
    const button = screen.getByRole('button', { name: 'Вернуть «gamma» из архива' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore.mock.calls[0][0].id).toBe(3)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('reports search text, part of speech and state', () => {
    const { onQueryText, onPos, onState } = setup({ filters: { pos: 'noun' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск' }), { target: { value: 'be' } })
    expect(onQueryText).toHaveBeenCalledWith('be')

    expect(screen.getByRole('button', { name: 'Сущ.', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Все', pressed: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Глаг.' }))
    expect(onPos).toHaveBeenCalledWith('verb')
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    expect(onPos).toHaveBeenCalledWith('')

    fireEvent.change(screen.getByRole('combobox', { name: 'Состояние' }), { target: { value: 'archived' } })
    expect(onState).toHaveBeenCalledWith('archived')
  })

  it('shows how many cards are loaded and asks for the next page', () => {
    const { cards } = setup({ cards: { total: 120 } })
    expect(screen.getByText('Загружено 3 из 120')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(cards.loadMore).toHaveBeenCalledTimes(1)
  })

  it('hides the next-page button when everything is loaded and disables it while loading', () => {
    setup()
    expect(screen.getByText('Загружено 3 из 3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull()
    cleanup()

    setup({ cards: { total: 120, loadingMore: true } })
    const busy = screen.getByRole('button', { name: 'Загрузка…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
  })

  it('explains an empty list', () => {
    setup({ items: [] })
    expect(screen.getByRole('status').textContent).toBe('Ничего не найдено')
    cleanup()

    setup({ items: [], cards: { loading: true } })
    expect(screen.getByRole('status').textContent).toBe('Загрузка…')
    cleanup()

    setup({ items: [], filters: { state: 'draft' } })
    expect(screen.getByRole('status').textContent).toBe('В черновике пока ничего нет')
  })

  it('shows a load error with a retry button', () => {
    const { cards } = setup({ cards: { error: { kind: 'network' } } })
    expect(screen.getByRole('alert').textContent).toContain('Нет связи с сервером')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(cards.reload).toHaveBeenCalledTimes(1)
  })

  describe('files from the draft', () => {
    it('shows a group row on top of the table with the file name and the number of new words', () => {
      setup({ imports: [fileOf('travel-words.json', 7), fileOf('b.json', 1), fileOf('c.json', 2)] })
      const groups = screen.getAllByRole('row').filter((row) => row.className === 'grp')
      expect(groups.map((row) => row.textContent)).toEqual([
        'Из файла · travel-words.json · 7 новых словУбрать',
        'Из файла · b.json · 1 новое словоУбрать',
        'Из файла · c.json · 2 новых словаУбрать',
      ])
      const all = screen.getAllByRole('row')
      expect(all.indexOf(groups[2])).toBeLessThan(all.indexOf(screen.getByRole('row', { name: /alpha/ })))
    })

    it('removes a file with its own button and keeps focus in the word list', () => {
      const { onRemoveImport, onOpen } = setup({ imports: [fileOf('a.json', 3), fileOf('b.json', 4)] })
      const button = screen.getByRole('button', { name: 'Убрать файл b.json из черновика' })
      button.focus()
      fireEvent.click(button)
      expect(onRemoveImport).toHaveBeenCalledWith(1)
      expect(onOpen).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Слова' }))
    })

    it('does not leave an empty list message when the draft only holds a file', () => {
      setup({ items: [], filters: { state: 'draft' }, imports: [fileOf('a.json', 3)] })
      expect(screen.queryByText('В черновике пока ничего нет')).toBeNull()
      expect(screen.getByText(/Из файла/)).toBeTruthy()
    })

    it('hides the group when a search, a part of speech or the archive is chosen', () => {
      const shown: string[] = []
      for (const filters of [{ q: 'alp' }, { pos: 'noun' }, { state: 'archived' as const }, { state: 'incomplete' as const }]) {
        setup({ filters, imports: [fileOf('a.json', 3)] })
        if (screen.queryByText(/Из файла/)) shown.push(JSON.stringify(filters))
        cleanup()
      }
      expect(shown).toEqual([])
    })
  })
})
