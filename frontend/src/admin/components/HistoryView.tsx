import { useEffect, useId, useRef, useState } from 'react'
import { type AdminApi, type ApiError, describeError } from '../api/admin'
import {
  CHANGES_PAGE,
  CHANGE_KIND_LABEL,
  addedHint,
  authorLabel,
  baseLabel,
  cardsCountText,
  changeKindClass,
  importedFileText,
  revisionBadges,
  revisionTitle,
} from '../history'
import type { ExportTarget } from '../hooks/useExport'
import { useRevisions } from '../hooks/useRevisions'
import { formatTime } from '../labels'
import type { DeckInfo, RevisionDetail, RevisionInfo } from '../types'

interface Props {
  api: AdminApi
  deck: DeckInfo
  exporting: ExportTarget | null
  reverting: number | null
  onExport: (revision: number) => void
  onRevert: (revision: number) => void
  onOpenVersion: (cardId: number, version: number) => void
}

type Details = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; detail: RevisionDetail } | { status: 'error'; error: ApiError }

export function HistoryView({ api, deck, exporting, reverting, onExport, onRevert, onOpenVersion }: Props) {
  const revisions = useRevisions(api, deck.revision)
  const latest = Math.max(deck.revision, revisions.items[0]?.revision ?? 0)

  return (
    <section className="content" aria-label="История ревизий">
      {revisions.error && (
        <div className="note warn" role="alert">
          <span>Не удалось загрузить ленту: {describeError(revisions.error)}</span>
          <button type="button" className="btn small" onClick={revisions.reload}>
            Повторить
          </button>
        </div>
      )}
      {revisions.loading && (
        <p className="empty" role="status">
          Загрузка…
        </p>
      )}
      <ol className="tl" aria-label="Ревизии, новые сверху">
        {revisions.items.map((rev) => (
          <RevisionItem
            key={rev.revision}
            api={api}
            rev={rev}
            current={rev.revision === latest}
            exporting={exporting}
            reverting={reverting}
            onExport={onExport}
            onRevert={onRevert}
            onOpenVersion={onOpenVersion}
          />
        ))}
      </ol>
      {revisions.items.length > 0 && (
        <div className="more">
          <span className="more__text">
            Загружено {revisions.items.length} из {latest}
          </span>
          {revisions.hasMore && (
            <button type="button" className="btn" onClick={revisions.loadMore} disabled={revisions.loadingMore}>
              {revisions.loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

interface ItemProps {
  api: AdminApi
  rev: RevisionInfo
  current: boolean
  exporting: ExportTarget | null
  reverting: number | null
  onExport: (revision: number) => void
  onRevert: (revision: number) => void
  onOpenVersion: (cardId: number, version: number) => void
}

function RevisionItem({ api, rev, current, exporting, reverting, onExport, onRevert, onOpenVersion }: ItemProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<Details>({ status: 'idle' })
  const [shown, setShown] = useState(CHANGES_PAGE)
  const controller = useRef<AbortController | null>(null)
  const badges = revisionBadges(rev)
  const n = rev.revision

  useEffect(() => () => controller.current?.abort(), [])

  const load = () => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setDetails({ status: 'loading' })
    void api.revision(n, { signal: next.signal }).then((result) => {
      if (next.signal.aborted) return
      if (result.ok) setDetails({ status: 'ready', detail: result.value })
      else if (result.error.kind !== 'aborted') setDetails({ status: 'error', error: result.error })
    })
  }

  const toggle = () => {
    if (!open && details.status !== 'ready' && details.status !== 'loading') load()
    setOpen(!open)
  }

  const changes = details.status === 'ready' ? details.detail.changes : []

  return (
    <li className="ev">
      <div className="r">r{n}</div>
      <div className="ev__main">
        <div className="t">{revisionTitle(rev)}</div>
        <div className="m">
          {authorLabel(rev.author)} · {formatTime(rev.createdAt)} · {baseLabel(rev)}
          {current && (
            <>
              {' '}
              · <b className="ev__now">текущая</b>
            </>
          )}
        </div>
        {(badges.added > 0 || badges.changed > 0 || badges.archived > 0) && (
          <div className="d">
            {badges.added > 0 && (
              <span className="tag new" title={addedHint(rev)}>
                +{badges.added}
              </span>
            )}
            {badges.changed > 0 && (
              <span className="tag mod" title="изменено карточек">
                ~{badges.changed}
              </span>
            )}
            {badges.archived > 0 && (
              <span className="tag del" title="ушло в архив">
                −{badges.archived}
              </span>
            )}
          </div>
        )}
        {rev.importedFiles.length > 0 && (
          <ul className="ev__files" aria-label="Загруженные файлы">
            {rev.importedFiles.map((file) => (
              <li key={file.name}>{importedFileText(file)}</li>
            ))}
          </ul>
        )}
        <button type="button" className="ev__toggle" aria-expanded={open} aria-controls={listId} aria-label={`${open ? 'Скрыть' : 'Показать'} карточки r${n}`} onClick={toggle}>
          {open ? 'Скрыть карточки' : 'Показать карточки'}
        </button>
        <div id={listId} hidden={!open}>
          {open && details.status === 'loading' && (
            <p className="ev__state" role="status">
              Загрузка…
            </p>
          )}
          {open && details.status === 'error' && (
            <div className="ev__state" role="alert">
              Не удалось загрузить карточки: {describeError(details.error)}{' '}
              <button type="button" className="btn small" onClick={load}>
                Повторить
              </button>
            </div>
          )}
          {open && details.status === 'ready' && (
            <>
              <p className="ev__count">{cardsCountText(changes.length)}</p>
              <ul className="ev__changes" aria-label={`Карточки r${n}`}>
                {changes.slice(0, shown).map((change) => (
                  <li key={`${change.cardId}:${change.version}`}>
                    <span className={changeKindClass(change.kind)}>{CHANGE_KIND_LABEL[change.kind]}</span>
                    <b lang="en">{change.word}</b>
                    <span className="ev__tr">{change.translation}</span>
                    <button
                      type="button"
                      className="linklike"
                      aria-label={`Открыть версию v${change.version} карточки «${change.word}»`}
                      onClick={() => onOpenVersion(change.cardId, change.version)}
                    >
                      v{change.version}
                    </button>
                  </li>
                ))}
              </ul>
              {changes.length > shown && (
                <button type="button" className="btn small" onClick={() => setShown(shown + CHANGES_PAGE)}>
                  Показать ещё (осталось {changes.length - shown})
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="ev__actions">
        <button type="button" className="btn ghost" aria-label={`Экспорт r${n}`} onClick={() => onExport(n)} disabled={exporting !== null}>
          {exporting === n ? 'Скачиваю…' : 'Экспорт'}
        </button>
        {!current && (
          <button type="button" className="btn" onClick={() => onRevert(n)} disabled={reverting !== null}>
            {reverting === n ? 'Собираю…' : `Откатить к r${n}`}
          </button>
        )}
      </div>
    </li>
  )
}
