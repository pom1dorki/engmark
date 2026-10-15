import { type RefObject, useRef } from 'react'
import { describeError } from '../api/admin'
import type { CardsState } from '../hooks/useCards'
import type { ImportGroup, ListFilters, Row, StateFilter } from '../rows'
import { WordsTable } from './WordsTable'
import { WordsToolbar } from './WordsToolbar'

interface Props {
  filters: ListFilters
  queryText: string
  onQueryText: (value: string) => void
  onPos: (value: string) => void
  onState: (value: StateFilter) => void
  searchRef: RefObject<HTMLInputElement | null>
  rows: Row[]
  groups: ImportGroup[]
  cards: CardsState
  selectedKey: string | null
  problems: Record<string, string[]>
  onOpen: (row: Row) => void
  onRestore: (row: Row) => void
  onRemoveImport: (index: number) => void
}

export function WordsView({ filters, queryText, onQueryText, onPos, onState, searchRef, rows, groups, cards, selectedKey, problems, onOpen, onRestore, onRemoveImport }: Props) {
  const section = useRef<HTMLElement>(null)
  const fromServer = filters.state !== 'draft'
  const remaining = cards.total - cards.items.length
  const busy = fromServer && cards.loading
  const nothing = rows.length === 0 && groups.length === 0

  const removeImport = (index: number) => {
    onRemoveImport(index)
    section.current?.focus()
  }

  return (
    <section className="content" ref={section} tabIndex={-1} aria-label="Слова" aria-busy={busy}>
      <WordsToolbar query={queryText} onQuery={onQueryText} pos={filters.pos} onPos={onPos} state={filters.state} onState={onState} searchRef={searchRef} />

      {cards.error && (
        <div className="note warn" role="alert">
          <span>Не удалось загрузить список: {describeError(cards.error)}</span>
          <button type="button" className="btn small" onClick={cards.reload}>
            Повторить
          </button>
        </div>
      )}

      {!nothing && (
        <div className={busy ? 'stale' : undefined}>
          <WordsTable rows={rows} groups={groups} selectedKey={selectedKey} problems={problems} onOpen={onOpen} onRestore={onRestore} onRemoveImport={removeImport} />
        </div>
      )}

      {nothing && !cards.error && (
        <div className="empty" role="status">
          {busy ? 'Загрузка…' : filters.state === 'draft' ? 'В черновике пока ничего нет' : 'Ничего не найдено'}
        </div>
      )}

      {fromServer && cards.items.length > 0 && (
        <div className="more">
          <span className="more__text">
            Загружено {cards.items.length} из {cards.total}
          </span>
          {remaining > 0 && (
            <button type="button" className="btn" onClick={cards.loadMore} disabled={cards.loadingMore}>
              {cards.loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
