import { useId } from 'react'
import type { Draft } from '../draft/draft'
import { MAX_MESSAGE, type ReviewItem, importProblemKey, reviewItems, summaryText } from '../saveFlow'
import { Modal } from './Modal'

export type SaveFailure =
  | { kind: 'failed'; text: string }
  | { kind: 'stale'; text: string }
  | { kind: 'rejected'; lines: string[] }

interface Props {
  draft: Draft
  message: string
  onMessage: (value: string) => void
  busy: boolean
  failure: SaveFailure | null
  resumed: boolean
  problems: Record<string, string[]>
  onSave: () => void
  onClose: () => void
}

const KIND_TAG: Record<ReviewItem['kind'], { className: string; text: string }> = {
  create: { className: 'tag new', text: 'Новая' },
  update: { className: 'tag mod', text: 'Изменена' },
  archive: { className: 'tag del', text: 'В архив' },
  restore: { className: 'tag new', text: 'Вернётся' },
}

const noop = () => undefined

export function SaveDialog({ draft, message, onMessage, busy, failure, resumed, problems, onSave, onClose }: Props) {
  const fieldId = useId()
  const items = reviewItems(draft)
  const files = draft.imports.map((file, index) => ({ file, index })).filter(({ file }) => file.cards.length > 0)
  const retry = failure?.kind === 'failed'

  return (
    <Modal
      title="Сохранить изменения"
      onClose={busy ? noop : onClose}
      footer={
        <>
          <span className="ver">{summaryText(draft)}</span>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Назад
          </button>
          <button type="button" className="btn pri" onClick={onSave} disabled={busy}>
            {busy ? 'Сохраняю…' : retry ? 'Повторить' : 'Сохранить'}
          </button>
        </>
      }
    >
      <p className="mdesc">
        Все изменения запишутся одной транзакцией. Если колода или любая из карточек изменилась после начала правки, сохранение остановится и ничего не запишется.
      </p>

      {resumed && (
        <div className="note info" role="status">
          <span>Вы снова вошли, черновик на месте. Нажмите «Сохранить», чтобы продолжить.</span>
        </div>
      )}

      {failure && (
        <div className="note warn" role="alert">
          {failure.kind === 'rejected' ? (
            <span>
              Сервер не принял изменения. Ничего не записано, черновик на месте.
              {failure.lines.map((line) => (
                <span className="note__line" key={line}>
                  {line}
                </span>
              ))}
            </span>
          ) : (
            <span>{failure.text}</span>
          )}
        </div>
      )}

      <ul className="clist" aria-label="Что будет записано">
        {items.map((item) => (
          <li className={problems[item.key] ? 'citem bad' : 'citem'} key={item.key}>
            <span className={KIND_TAG[item.kind].className}>
              <i className="dot" aria-hidden="true" />
              {KIND_TAG[item.kind].text}
            </span>
            <b lang="en">{item.word}</b>
            <span className="citem__tr">{item.translation}</span>
            <span className="ver">{item.version}</span>
            {item.changed && <span className="citem__sub">Изменено: {item.changed}</span>}
            {problems[item.key]?.map((line) => (
              <span className="citem__why" key={line}>
                {line}
              </span>
            ))}
          </li>
        ))}
        {files.map(({ file, index }) => {
          const why = problems[importProblemKey(index)]
          return (
            <li className={why ? 'citem bad' : 'citem'} key={`file-${index}`}>
              <span className="tag new">
                <i className="dot" aria-hidden="true" />
                Файл
              </span>
              <b>{file.fileName}</b>
              <span className="citem__tr">{file.cards.length} новых карточек</span>
              <span className="ver">v1</span>
              {why?.map((line) => (
                <span className="citem__why" key={line}>
                  {line}
                </span>
              ))}
            </li>
          )
        })}
      </ul>

      <div className="f">
        <label htmlFor={fieldId}>Комментарий к ревизии</label>
        <input
          id={fieldId}
          type="text"
          value={message}
          maxLength={MAX_MESSAGE}
          placeholder="Необязательно"
          onChange={(event) => onMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) {
              event.preventDefault()
              onSave()
            }
          }}
        />
        <span className="hint">Виден в истории ревизий. Если оставить пустым, сервер подпишет ревизию сам.</span>
      </div>
    </Modal>
  )
}
