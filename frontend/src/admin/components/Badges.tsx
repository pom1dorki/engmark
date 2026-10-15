import { posShort } from '../labels'
import { FIELD_COUNT, type Row } from '../rows'

export function PosBadge({ pos }: { pos: string }) {
  return <span className={`pos ${pos}`}>{posShort(pos)}</span>
}

export function FillBar({ filled }: { filled: number }) {
  const percent = Math.round((filled / FIELD_COUNT) * 100)
  return (
    <span className="fill">
      <span className={percent < 80 ? 'bar low' : 'bar'} aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </span>
      <span>
        {filled}/{FIELD_COUNT}
      </span>
    </span>
  )
}

const STATE_TAGS: Record<Exclude<Row['state'], 'published' | 'archived'>, { className: string; text: string }> = {
  new: { className: 'tag new', text: 'Новое' },
  changed: { className: 'tag mod', text: 'Изменено' },
  archiving: { className: 'tag del', text: 'В архив' },
  restoring: { className: 'tag new', text: 'Вернётся' },
}

export function StateTag({ row, onRestore }: { row: Row; onRestore: (row: Row) => void }) {
  if (row.state === 'published') return <span className="tag ok">Опубликовано</span>
  if (row.state === 'archived') {
    return (
      <span className="tag ok">
        В архиве
        <button
          type="button"
          className="btn ghost small"
          aria-label={`Вернуть «${row.card.word}» из архива`}
          onClick={(event) => {
            event.stopPropagation()
            onRestore(row)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          Вернуть
        </button>
      </span>
    )
  }
  const tag = STATE_TAGS[row.state]
  return (
    <span className={tag.className}>
      <i className="dot" aria-hidden="true" />
      {tag.text}
    </span>
  )
}
