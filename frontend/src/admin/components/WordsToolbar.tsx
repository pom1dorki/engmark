import type { RefObject } from 'react'
import { POS_SEGMENTS } from '../labels'
import { STATE_OPTIONS, type StateFilter } from '../rows'
import { Icon } from './Icon'

interface Props {
  query: string
  onQuery: (value: string) => void
  pos: string
  onPos: (value: string) => void
  state: StateFilter
  onState: (value: StateFilter) => void
  searchRef: RefObject<HTMLInputElement | null>
}

export function WordsToolbar({ query, onQuery, pos, onPos, state, onState, searchRef }: Props) {
  return (
    <div className="toolbar">
      <div className="search">
        <Icon name="search" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Поиск по слову или переводу"
          aria-label="Поиск"
          aria-keyshortcuts="/"
          title="Поиск: клавиша /"
          autoComplete="off"
        />
      </div>
      <div className="seg" role="group" aria-label="Фильтр по части речи">
        {POS_SEGMENTS.map((segment) => (
          <button key={segment.value} type="button" className={pos === segment.value ? 'on' : ''} aria-pressed={pos === segment.value} onClick={() => onPos(segment.value)}>
            {segment.label}
          </button>
        ))}
      </div>
      <select className="sel" aria-label="Состояние" value={state} onChange={(event) => onState(event.target.value as StateFilter)}>
        {STATE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
