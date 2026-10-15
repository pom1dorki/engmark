import { useEffect, useState } from 'react'
import { type Draft, draftCounts } from '../draft/draft'

interface Props {
  draft: Draft
  serverRevision?: number
  onReview?: () => void
  onSave?: () => void
  onDiscardAll: () => void
}

const CONFIRM_MS = 5000

export function DraftBar({ draft, serverRevision, onReview, onSave, onDiscardAll }: Props) {
  const counts = draftCounts(draft)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  const parts: [number, string][] = [
    [counts.created, 'новых'],
    [counts.updated, 'изменено'],
    [counts.archived, 'в архив'],
    [counts.restored, 'из архива'],
    [counts.imported, 'из файла'],
  ]
  const shown = parts.filter(([n]) => n > 0)
  const total = parts.reduce((sum, [n]) => sum + n, 0)
  const behind = serverRevision !== undefined && serverRevision > draft.baseRevision

  return (
    <div className="cbar" role="region" aria-label="Черновик">
      <div>
        <div className="s" role="status">
          Черновик:{' '}
          {shown.map(([n, label], index) => (
            <span key={label}>
              {index > 0 && ' · '}
              <b>{n}</b> {label}
            </span>
          ))}
        </div>
        <div className="base">
          {draft.message ? `«${draft.message}» · ` : ''}
          {behind
            ? `основан на ревизии r${draft.baseRevision}, на сервере уже r${serverRevision} · нужно обновить основу`
            : `основан на ревизии r${draft.baseRevision} · сохранится как r${draft.baseRevision + 1}`}
        </div>
        {confirming && (
          <div className="base" role="status">
            Нажмите ещё раз, чтобы отменить все изменения ({total})
          </div>
        )}
      </div>
      <button type="button" className="btn" onClick={onReview} disabled={!onReview}>
        Просмотреть
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          if (confirming) {
            setConfirming(false)
            onDiscardAll()
          } else setConfirming(true)
        }}
        onBlur={() => setConfirming(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && confirming) {
            event.stopPropagation()
            setConfirming(false)
          }
        }}
      >
        {confirming ? 'Да, отменить всё' : 'Отменить всё'}
      </button>
      <button type="button" className="btn pri" onClick={onSave} disabled={!onSave}>
        Сохранить изменения
      </button>
    </div>
  )
}
