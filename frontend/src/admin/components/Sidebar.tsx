import type { DeckInfo } from '../types'
import { Icon } from './Icon'

export type View = 'words' | 'history'

interface Props {
  view: View
  onView: (view: View) => void
  deck: DeckInfo
  offline: boolean
  onLogout?: () => void
  loggingOut?: boolean
}

export function Sidebar({ view, onView, deck, offline, onLogout, loggingOut = false }: Props) {
  return (
    <aside className="side">
      <div className="brand">
        <div className="logo" aria-hidden="true">
          E
        </div>
        <div>
          <b>Engmark</b>
          <small>Администрирование</small>
        </div>
      </div>
      <nav className="side__nav" aria-label="Разделы">
        <button type="button" className={view === 'words' ? 'nav on' : 'nav'} aria-current={view === 'words' ? 'page' : undefined} onClick={() => onView('words')}>
          <Icon name="words" />
          Слова
          <span className="n">{deck.activeCards}</span>
        </button>
        <button type="button" className={view === 'history' ? 'nav on' : 'nav'} aria-current={view === 'history' ? 'page' : undefined} onClick={() => onView('history')}>
          <Icon name="history" />
          История ревизий
          <span className="n">{deck.revision}</span>
        </button>
      </nav>
      <div className="grow" />
      <div className="deckbox">
        <div className="k">Колода</div>
        <div>
          <b>{deck.title}</b> · admin
        </div>
        <div className="k deckbox__gap">Ревизия на сервере</div>
        <div className="v">r{deck.revision}</div>
        {offline && (
          <div className="deckbox__offline" role="status">
            Нет связи с сервером
          </div>
        )}
      </div>
      {onLogout && (
        <button type="button" className="nav nav--out" onClick={onLogout} disabled={loggingOut}>
          <Icon name="logout" />
          {loggingOut ? 'Выхожу…' : 'Выйти'}
        </button>
      )}
    </aside>
  )
}
