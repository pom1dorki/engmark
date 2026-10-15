import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AdminApi } from '../api/admin'
import { type Draft, type DraftAction, nextCreateKey } from '../draft/draft'
import type { EditorModel } from '../editorModel'
import { useDuplicateMatches } from '../hooks/useDuplicateMatches'
import { FIELD_LABELS } from '../labels'
import { findDuplicate } from '../rows'
import { type CardData, type CardField, sameCard } from '../types'
import { trimCard, validateCard } from '../validate/validate'
import { CardPreview } from './CardPreview'
import { PosField, TextField } from './Field'

interface Props {
  api: AdminApi
  model: EditorModel
  draft: Draft
  dispatch: (action: DraftAction) => void
  onClose: () => void
  onToast: (text: string) => void
  startWith?: CardData
}

const WORD_HINT = 'Латиница, апостроф, дефис, одиночные пробелы'

export function CardForm({ api, model, draft, dispatch, onClose, onToast, startWith }: Props) {
  const formId = useId()
  const wordRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<CardData>(startWith ?? model.initial)
  const readOnly = model.mode !== 'edit'

  useEffect(() => {
    wordRef.current?.focus()
  }, [])

  const trimmed = useMemo(() => trimCard(value), [value])
  const issues = useMemo(() => validateCard(trimmed), [trimmed])
  const wordOk = trimmed.word !== '' && !issues.some((issue) => issue.field === 'word')
  const matches = useDuplicateMatches(api, trimmed.word, wordOk && !readOnly)
  const duplicate = useMemo(
    () => (wordOk && trimmed.translation !== '' && !readOnly ? findDuplicate(trimmed, model.key, draft, matches) : null),
    [wordOk, trimmed, readOnly, model.key, draft, matches],
  )

  const errors = useMemo(() => {
    const out: Partial<Record<CardField, string>> = {}
    for (const issue of issues) if (!(issue.field in out)) out[issue.field] = issue.message
    if (duplicate && !out.word) {
      out.word = `Такая карточка уже есть ${duplicate.where === 'deck' ? 'в колоде' : 'в черновике'} (слово + часть речи + перевод)`
    }
    return out
  }, [issues, duplicate])

  const hasErrors = Object.keys(errors).length > 0
  const canApply = !readOnly && !hasErrors && !sameCard(trimmed, model.initial)
  const base = model.base
  const isChanged = (field: CardField) => base !== null && trimmed[field] !== base[field]
  const existing = model.id !== null && base !== null && model.baseVersion !== null

  const set = (field: CardField) => (next: string) => setValue((prev) => ({ ...prev, [field]: next }))
  const common = (field: CardField) => ({
    name: field,
    label: FIELD_LABELS[field],
    value: value[field],
    onChange: set(field),
    changed: isChanged(field),
    error: errors[field],
    readOnly,
  })

  function apply() {
    if (!canApply) return
    if (model.id !== null && base !== null && model.baseVersion !== null) {
      dispatch({ type: 'upsertUpdate', id: model.id, baseVersion: model.baseVersion, base, card: trimmed })
      onToast(sameCard(trimmed, base) ? `Правки «${trimmed.word}» отменены` : `Правки «${trimmed.word}» в черновике · основа v${model.baseVersion}`)
    } else {
      dispatch({ type: 'upsertCreate', key: model.key ?? nextCreateKey(draft), card: trimmed })
      onToast(model.key === null ? `«${trimmed.word}» добавлено в черновик` : `Правки «${trimmed.word}» в черновике`)
    }
    onClose()
  }

  function archive() {
    if (model.id === null || base === null || model.baseVersion === null) return
    dispatch({ type: 'archive', id: model.id, baseVersion: model.baseVersion, base })
    onToast(`«${base.word}» уйдёт в архив при сохранении`)
    onClose()
  }

  function restore() {
    if (model.id === null || base === null || model.baseVersion === null) return
    dispatch({ type: 'restore', id: model.id, baseVersion: model.baseVersion, base })
    onToast(`«${base.word}» вернётся из архива`)
    onClose()
  }

  function cancelArchiving() {
    if (model.key === null) return
    dispatch({ type: 'discardItem', key: model.key })
    onToast(`Архивирование «${model.initial.word}» отменено`)
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      apply()
    }
  }

  const archivedNote =
    model.mode === 'archived'
      ? 'Карточка в архиве. Чтобы править её, верните из архива.'
      : model.mode === 'archiving'
        ? 'Карточка уйдёт в архив при сохранении. Чтобы править её, отмените архивирование.'
        : null

  return (
    <div className="drawer__main" onKeyDown={onKeyDown}>
      <form
        id={formId}
        className="db"
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        {archivedNote && <p className="note info">{archivedNote}</p>}

        <fieldset className="group">
          <legend>Основное</legend>
          <TextField {...common('word')} required lang="en" inputRef={wordRef} hint={WORD_HINT} />
          <div className="row">
            <PosField {...common('pos')} required />
            <TextField {...common('translation')} required />
          </div>
        </fieldset>

        <fieldset className="group">
          <legend>Произношение</legend>
          <div className="row">
            <TextField {...common('ipa')} placeholder="/weər/" />
            <TextField {...common('pronunciation')} placeholder="[уэа(р)]" />
          </div>
          <TextField {...common('stressNote')} />
        </fieldset>

        <fieldset className="group">
          <legend>Описание</legend>
          <TextField {...common('grammar')} multiline rows={2} />
          <TextField {...common('usage')} multiline rows={2} />
        </fieldset>

        <fieldset className="group">
          <legend>Пример</legend>
          <TextField {...common('example')} multiline rows={2} lang="en" />
          <div className="row">
            <TextField {...common('exampleHighlight')} />
            <TextField {...common('exampleTranslation')} />
          </div>
        </fieldset>

        <section className="group" aria-label="Предпросмотр карточки">
          <h3>Предпросмотр</h3>
          <CardPreview card={trimmed} />
        </section>
      </form>

      <div className="df">
        {model.mode === 'edit' && existing && model.inDraft !== 'restore' && (
          <button type="button" className="btn danger ghost" onClick={archive}>
            В архив
          </button>
        )}
        <div className="spacer" />
        {model.mode === 'archived' && (
          <button type="button" className="btn pri" onClick={restore}>
            Вернуть из архива
          </button>
        )}
        {model.mode === 'archiving' && (
          <button type="button" className="btn pri" onClick={cancelArchiving}>
            Отменить архивирование
          </button>
        )}
        {model.mode === 'edit' && (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" form={formId} className="btn pri" disabled={!canApply}>
              {model.inDraft ? 'Обновить в черновике' : 'В черновик'}
            </button>
          </>
        )}
        {model.mode !== 'edit' && (
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
    </div>
  )
}
