import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { type AdminApi, type ApiError, describeError } from '../api/admin'
import type { Draft, DraftAction } from '../draft/draft'
import { type EditorModel, type EditorTarget, needsFetch, resolveEditor } from '../editorModel'
import { formatTime } from '../labels'
import type { CardData, CardVersion, ServerCard } from '../types'
import { CardForm } from './CardForm'
import { Icon } from './Icon'
import { VersionsTab } from './VersionsTab'

interface Props {
  api: AdminApi
  target: EditorTarget
  draft: Draft
  dispatch: (action: DraftAction) => void
  onClose: () => void
  onToast: (text: string) => void
}

type Fetched = { id: number; card: ServerCard } | { id: number; error: ApiError }

type Tab = 'card' | 'versions'

const LOCKED_REASON: Partial<Record<EditorModel['mode'], string>> = {
  archived: 'Карточка в архиве: верните её из архива, чтобы править.',
  archiving: 'Карточка уйдёт в архив при сохранении: отмените архивирование, чтобы править.',
}

const DISCARD_TEXT: Record<NonNullable<EditorModel['inDraft']>, (word: string) => string> = {
  create: (word) => `«${word}» убрано из черновика`,
  update: (word) => `Правки «${word}» убраны из черновика`,
  archive: (word) => `Архивирование «${word}» отменено`,
  restore: (word) => `Возврат «${word}» из архива отменён`,
}

export function CardEditor({ api, target, draft, dispatch, onClose, onToast }: Props) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cardId = target.kind === 'card' ? target.id : null
  const startVersion = target.kind === 'card' && target.version !== undefined ? target.version : null
  const [tab, setTab] = useState<Tab>(startVersion === null ? 'card' : 'versions')
  const [taken, setTaken] = useState<{ nonce: number; card: CardData } | null>(null)
  const tabsId = useId()
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({ card: null, versions: null })
  const fetchNeeded = needsFetch(target, draft)

  useEffect(() => {
    if (cardId === null || !fetchNeeded) return
    const controller = new AbortController()
    void api.card(cardId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setFetched({ id: cardId, card: result.value })
      else if (result.error.kind !== 'aborted') setFetched({ id: cardId, error: result.error })
    })
    return () => controller.abort()
  }, [api, cardId, fetchNeeded, attempt])

  const mine = fetched && fetched.id === cardId ? fetched : null
  const card = mine && 'card' in mine ? mine.card : null
  const error = mine && 'error' in mine ? mine.error : null
  const model = resolveEditor(target, draft, card)

  const retry = () => {
    setFetched(null)
    setAttempt((n) => n + 1)
  }

  const discard = () => {
    if (!model || model.key === null || model.inDraft === null) return
    dispatch({ type: 'discardItem', key: model.key })
    onToast(DISCARD_TEXT[model.inDraft](model.initial.word))
    onClose()
  }

  let title = 'Новое слово'
  let meta = 'Ещё не сохранено'
  if (target.kind !== 'new') {
    title = model ? model.initial.word : 'Карточка'
    if (!model) meta = 'Загрузка…'
    else if (model.id === null) meta = 'Новая карточка в черновике'
    else {
      const parts = [`ID ${model.id}`, `версия v${model.baseVersion}`]
      if (card) parts.push(`изменено ${formatTime(card.updatedAt)}`)
      if (model.mode === 'archived') parts.push('в архиве')
      if (model.inDraft) parts.push('есть правки в черновике')
      meta = parts.join(' · ')
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  const take = (version: CardVersion) => {
    setTaken({ nonce: (taken?.nonce ?? 0) + 1, card: version.card })
    setTab('card')
    onToast(`Значения из v${version.version} подставлены в форму. Проверьте их и добавьте правку в черновик.`)
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next: Tab | null = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (tab === 'card' ? 'versions' : 'card') : event.key === 'Home' ? 'card' : event.key === 'End' ? 'versions' : null
    if (next === null) return
    event.preventDefault()
    setTab(next)
    tabButtons.current[next]?.focus()
  }

  const hasVersions = cardId !== null
  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`${tabsId}-tab-${id}`}
      ref={(element: HTMLButtonElement | null) => {
        tabButtons.current[id] = element
      }}
      className={tab === id ? 'tab on' : 'tab'}
      aria-selected={tab === id}
      aria-controls={`${tabsId}-panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={onTabKeyDown}
    >
      {label}
    </button>
  )

  return (
    <aside className="drawer" aria-label="Редактор карточки" onKeyDown={onKeyDown}>
      <div className="dh">
        <div className="dh__text">
          <h2 lang={model ? 'en' : undefined}>{title}</h2>
          <div className="meta">{meta}</div>
          {model?.inDraft && (
            <button type="button" className="btn ghost small" onClick={discard}>
              Убрать из черновика
            </button>
          )}
        </div>
        <button type="button" className="btn ghost icon" aria-label="Закрыть редактор" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {hasVersions && (
        <div className="tabs" role="tablist" aria-label="Разделы карточки">
          {tabButton('card', 'Карточка')}
          {tabButton('versions', 'Версии')}
        </div>
      )}

      <div
        className="drawer__panel"
        role={hasVersions ? 'tabpanel' : undefined}
        id={hasVersions ? `${tabsId}-panel-card` : undefined}
        aria-labelledby={hasVersions ? `${tabsId}-tab-card` : undefined}
        hidden={tab !== 'card'}
      >
        {model ? (
          <CardForm
            key={`${model.key ?? 'new'}:${model.baseVersion ?? 0}:${model.inDraft ?? ''}:${taken?.nonce ?? 0}`}
            api={api}
            model={model}
            draft={draft}
            dispatch={dispatch}
            onClose={onClose}
            onToast={onToast}
            startWith={taken?.card}
          />
        ) : error ? (
          <div className="drawer__state" role="alert">
            <p>Не удалось открыть карточку: {describeError(error)}</p>
            <button type="button" className="btn" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : (
          <div className="drawer__state" role="status">
            Загрузка карточки…
          </div>
        )}
      </div>

      {hasVersions && tab === 'versions' && (
        <div className="drawer__panel" role="tabpanel" id={`${tabsId}-panel-versions`} aria-labelledby={`${tabsId}-tab-versions`}>
          <VersionsTab api={api} cardId={cardId} lockedReason={model ? (LOCKED_REASON[model.mode] ?? null) : null} initialVersion={startVersion} onTake={take} />
        </div>
      )}
    </aside>
  )
}
