import { Icon } from './Icon'
import type { View } from './Sidebar'

interface Props {
  view: View
  deckTitle: string
  baseRevision: number
  exporting: boolean
  onNew: () => void
  onImport: () => void
  onExport: () => void
}

export function Header({ view, deckTitle, baseRevision, exporting, onNew, onImport, onExport }: Props) {
  return (
    <header className="top">
      <div>
        <div className="crumb">Колода {deckTitle}</div>
        <h1>{view === 'words' ? 'Слова' : 'История ревизий'}</h1>
      </div>
      <span className="rev" title="Ревизия, на основе которой вы редактируете">
        основа r{baseRevision}
      </span>
      <div className="spacer" />
      {view === 'words' && (
        <div className="top__actions">
          <button type="button" className="btn" aria-label="Экспорт текущей колоды" onClick={onExport} disabled={exporting}>
            <Icon name="upload" />
            <span className="hide-s">{exporting ? 'Скачиваю…' : 'Экспорт'}</span>
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Загрузить JSON"
            onClick={onImport}
          >
            <Icon name="download" />
            <span className="hide-s">Загрузить JSON</span>
          </button>
          <button type="button" className="btn pri" onClick={onNew}>
            <Icon name="plus" />
            Новое слово
          </button>
        </div>
      )}
    </header>
  )
}
