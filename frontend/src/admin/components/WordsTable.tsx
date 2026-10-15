import type { KeyboardEvent } from 'react'
import { plural } from '../labels'
import { type ImportGroup, type Row, versionText } from '../rows'
import { importProblemKey } from '../saveFlow'
import { FillBar, PosBadge, StateTag } from './Badges'

interface Props {
  rows: Row[]
  groups: ImportGroup[]
  selectedKey: string | null
  problems: Record<string, string[]>
  onOpen: (row: Row) => void
  onRestore: (row: Row) => void
  onRemoveImport: (index: number) => void
}

export function WordsTable({ rows, groups, selectedKey, problems, onOpen, onRestore, onRemoveImport }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(row)
    }
  }

  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Слова колоды</caption>
        <thead>
          <tr>
            <th scope="col">Слово</th>
            <th scope="col">Часть речи</th>
            <th scope="col">Перевод</th>
            <th scope="col" className="hide-s">
              Заполнено
            </th>
            <th scope="col" className="hide-s">
              Версия
            </th>
            <th scope="col">Состояние</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={`file-${group.index}`} className="grp">
              <td colSpan={6}>
                <div className="grp__cell">
                  <span className="grp__text">
                    Из файла · <b>{group.fileName}</b> · {group.count} {plural(group.count, 'новое слово', 'новых слова', 'новых слов')}
                    {problems[importProblemKey(group.index)] && <span className="grp__bad"> · не принят сервером: {problems[importProblemKey(group.index)].join('; ')}</span>}
                  </span>
                  <button type="button" className="btn small" aria-label={`Убрать файл ${group.fileName} из черновика`} onClick={() => onRemoveImport(group.index)}>
                    Убрать
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rows.map((row) => (
            <tr
              key={row.key}
              data-key={row.key}
              tabIndex={0}
              className={[row.key === selectedKey ? 'sel' : '', row.state === 'archived' ? 'archived' : '', problems[row.key] ? 'bad' : ''].filter(Boolean).join(' ')}
              aria-current={row.key === selectedKey ? 'true' : undefined}
              onClick={() => onOpen(row)}
              onKeyDown={(event) => onKeyDown(event, row)}
            >
              <td className="w" lang="en">
                {row.card.word}
              </td>
              <td>
                <PosBadge pos={row.card.pos} />
              </td>
              <td className="tr">{row.card.translation}</td>
              <td className="hide-s">
                <FillBar filled={row.filled} />
              </td>
              <td className="hide-s ver">{versionText(row)}</td>
              <td>
                <StateTag row={row} onRestore={onRestore} />
                {problems[row.key] && (
                  <span className="tag del" title={problems[row.key].join('; ')}>
                    Не принято
                    <span className="sr-only">: {problems[row.key].join('; ')}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
