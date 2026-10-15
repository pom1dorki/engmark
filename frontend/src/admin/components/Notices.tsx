import type { DraftNotice } from '../draft/storage'
import { Icon } from './Icon'

const NOTICE_TEXT: Record<DraftNotice, string> = {
  schema: 'Сохранённый черновик остался от другой версии админки и был сброшен.',
  deck: 'Сохранённый черновик относился к другой колоде и был сброшен.',
  corrupt: 'Сохранённый черновик повреждён и был сброшен.',
}

interface RevisionProps {
  serverRevision: number
  baseRevision: number
  busy: boolean
  conflictWords: string[] | null
  onRefresh: () => void
}

export function RevisionBanner({ serverRevision, baseRevision, busy, conflictWords, onRefresh }: RevisionProps) {
  return (
    <div className="banner" role="status">
      <Icon name="info" />
      <div className="banner__text">
        <span>
          Колода обновилась до <b>r{serverRevision}</b>
          <span className="banner__muted"> · ваш черновик основан на r{baseRevision}</span>
        </span>
        {conflictWords && (
          <span className="banner__warn">
            Изменения пересекаются с серверными в карточках: {conflictWords.join(', ')}. Основа не обновлена, черновик цел. Решить, что оставить, можно будет при сохранении.
          </span>
        )}
      </div>
      <button type="button" className="btn small" onClick={onRefresh} disabled={busy}>
        {busy ? 'Обновляю…' : 'Обновить основу'}
      </button>
    </div>
  )
}

interface DraftNoticesProps {
  notice: DraftNotice | null
  onDismiss: () => void
  externalChange: boolean
  onAcceptExternal: () => void
  onKeepMine: () => void
}

export function DraftNotices({ notice, onDismiss, externalChange, onAcceptExternal, onKeepMine }: DraftNoticesProps) {
  return (
    <>
      {notice && (
        <div className="banner warn" role="status">
          <Icon name="warn" />
          <div className="banner__text">{NOTICE_TEXT[notice]}</div>
          <button type="button" className="btn small" onClick={onDismiss}>
            Понятно
          </button>
        </div>
      )}
      {externalChange && (
        <div className="banner warn" role="alert">
          <Icon name="warn" />
          <div className="banner__text">Черновик изменили в другой вкладке. Пока вы не выберете, здесь он не сохраняется.</div>
          <button type="button" className="btn small" onClick={onAcceptExternal}>
            Взять из другой вкладки
          </button>
          <button type="button" className="btn small" onClick={onKeepMine}>
            Оставить мой
          </button>
        </div>
      )}
    </>
  )
}

export interface ProblemLine {
  key: string
  label: string
  messages: string[]
  openable: boolean
}

interface ProblemsProps {
  items: ProblemLine[]
  general: string[]
  onOpen: (key: string) => void
  onDismiss: () => void
}

export function SaveProblems({ items, general, onOpen, onDismiss }: ProblemsProps) {
  return (
    <div className="banner warn" role="alert">
      <Icon name="warn" />
      <div className="banner__text">
        <span>Сервер не принял изменения. Ничего не записано, черновик на месте. Исправьте отмеченное и сохраните снова.</span>
        {(general.length > 0 || items.length > 0) && (
          <ul className="banner__list">
            {general.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {items.map((item) => (
              <li key={item.key}>
                {item.openable ? (
                  <button type="button" className="btn ghost small" onClick={() => onOpen(item.key)}>
                    {item.label}
                  </button>
                ) : (
                  <b>{item.label}</b>
                )}
                : {item.messages.join('; ')}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn small" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  )
}
