import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { AdminApi, ApiResult } from '../api/admin'
import { downloadText } from '../download'
import type { Draft, DraftImport } from '../draft/draft'
import { type ImportFailure, analyzeImport, importFailure } from '../importFile'
import {
  type AnalysisOk,
  type Review,
  LIST_LIMIT,
  SAMPLE_FILE_NAME,
  SAMPLE_TEXT,
  applyServerResult,
  buildErrorReport,
  buildImportScope,
  clipFileName,
  errorReportName,
  parseDeckKeys,
  readText,
  reviewWithoutServer,
  toDraftImport,
  validateBody,
} from '../importFlow'
import { labelReason, plural } from '../labels'
import type { ValidationReport } from '../types'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '../validate/rules'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface Props {
  api: AdminApi
  draft: Draft
  onAdd: (file: DraftImport) => void
  onClose: () => void
  save?: (fileName: string, text: string) => void
}

type Loaded = { name: string; text: string } | { name: string; failure: ImportFailure }

type DeckState = { status: 'loading' } | { status: 'ready'; keys: ReadonlySet<string> } | { status: 'unknown' }

const NO_KEYS: ReadonlySet<string> = new Set()

const DUPLICATE_WHERE = { deck: 'в колоде', draft: 'в черновике', file: 'повтор в файле' } as const

function summary(view: Review): string {
  return `Проверено: будут добавлены ${view.cards.length}, уже есть ${view.duplicates.length}, с ошибками ${view.errors.length}.`
}

function MoreRow({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <li className="issue more-row">…и ещё {total - shown}. Полный список в отчёте.</li> : null
}

export function ImportDialog({ api, draft, onAdd, onClose, save = downloadText }: Props) {
  const [file, setFile] = useState<Loaded | null>(null)
  const [over, setOver] = useState(false)
  const [deck, setDeck] = useState<DeckState>({ status: 'loading' })
  const [server, setServer] = useState<{ analysis: AnalysisOk; result: ApiResult<ValidationReport> } | null>(null)
  const reading = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    void api.exportCurrent({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      const keys = result.ok ? parseDeckKeys(result.value) : null
      setDeck(keys ? { status: 'ready', keys } : { status: 'unknown' })
    })
    return () => controller.abort()
  }, [api])

  const scope = useMemo(() => buildImportScope(deck.status === 'ready' ? deck.keys : NO_KEYS, draft), [deck, draft])

  const analysis = useMemo(() => {
    if (!file) return null
    if ('failure' in file) return importFailure(file.failure)
    return deck.status === 'loading' ? null : analyzeImport(file.text, scope.context)
  }, [file, deck.status, scope])

  const body = useMemo(
    () => (file && analysis?.ok ? validateBody(analysis, file.name, draft.baseRevision) : null),
    [file, analysis, draft.baseRevision],
  )

  useEffect(() => {
    if (!analysis?.ok || !body) return
    const controller = new AbortController()
    void api.validate(body, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setServer({ analysis, result })
    })
    return () => controller.abort()
  }, [api, analysis, body])

  const { view, pending } = useMemo(() => {
    if (!analysis?.ok) return { view: null, pending: false }
    const local = reviewWithoutServer(analysis)
    if (body === null) return { view: local, pending: false }
    if (server?.analysis === analysis) return { view: applyServerResult(analysis, server.result, scope.freed), pending: false }
    return { view: local, pending: true }
  }, [analysis, body, server, scope])

  const pick = async (blob: File) => {
    const ticket = ++reading.current
    const name = blob.name
    let next: Loaded
    if (blob.size > MAX_IMPORT_BYTES) next = { name, failure: 'too_large' }
    else {
      try {
        next = { name, text: await readText(blob) }
      } catch {
        next = { name, failure: 'invalid_json' }
      }
    }
    if (ticket === reading.current) setFile(next)
  }

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (chosen) void pick(chosen)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) void pick(dropped)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(true)
  }

  const useSample = () => {
    reading.current++
    setFile({ name: SAMPLE_FILE_NAME, text: SAMPLE_TEXT })
  }

  const sameFile = file !== null && draft.imports.some((item) => item.fileName === clipFileName(file.name))
  const canAdd = view !== null && !pending && view.checked !== 'rejected' && view.cards.length > 0

  const add = () => {
    if (file && view && canAdd) onAdd(toDraftImport(view, file.name))
  }

  const download = () => {
    if (file && view) save(errorReportName(file.name), buildErrorReport(file.name, view))
  }

  const footer = (
    <>
      {view && view.errors.length > 0 && (
        <button type="button" className="btn" onClick={download}>
          Скачать отчёт об ошибках
        </button>
      )}
      <div className="spacer" />
      <button type="button" className="btn ghost" onClick={onClose}>
        Отмена
      </button>
      <button type="button" className="btn pri" onClick={add} disabled={!canAdd}>
        {pending ? 'Проверяю…' : view ? `Добавить ${view.cards.length} в черновик` : 'Добавить в черновик'}
      </button>
    </>
  )

  return (
    <Modal title="Загрузка слов из JSON" onClose={onClose} footer={footer}>
      <p className="mdesc">
        Файл — массив карточек в формате data/cards.json. Обязательны слово, часть речи и перевод, остальные поля можно не заполнять. Дубли пропускаются, ошибка в одной
        строке не мешает остальным.
      </p>

      <div className={over ? 'drop over' : 'drop'} onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <Icon name="upload" />
        <p className="drop__title">Перетащите файл .json сюда</p>
        <div className="drop__actions">
          <label className="btn filebtn">
            Выбрать файл
            <input type="file" accept=".json,application/json" className="sr-only" onChange={onInput} />
          </label>
          <button type="button" className="btn ghost" onClick={useSample}>
            Использовать пример файла
          </button>
        </div>
        <p className="drop__hint">
          До {MAX_IMPORT_BYTES / 1024 / 1024} МБ и {MAX_IMPORT_ROWS} карточек
        </p>
      </div>

      {file && (
        <div className="note info" role="status">
          <span>
            Файл <b>{file.name}</b>
            {analysis?.ok && (
              <>
                {' '}
                · {analysis.total} {plural(analysis.total, 'запись', 'записи', 'записей')}
              </>
            )}
          </span>
        </div>
      )}

      {file && analysis === null && (
        <p className="check" role="status">
          Загружаю колоду для сверки…
        </p>
      )}

      {analysis && !analysis.ok && (
        <div className="note warn" role="alert">
          <span>{analysis.message}</span>
        </div>
      )}

      {sameFile && file && (
        <div className="note warn" role="status">
          <span>
            Файл «{file.name}» уже добавлен в черновик. Повторяющиеся карточки будут пропущены как дубли; если это другой файл с тем же именем, всё в порядке.
          </span>
        </div>
      )}

      {view && (
        <>
          <div className="stats" role="group" aria-label="Результат проверки">
            <div className="stat ok">
              <b>{view.cards.length}</b>
              <span>будут добавлены</span>
            </div>
            <div className="stat skip">
              <b>{view.duplicates.length}</b>
              <span>уже есть — пропуск</span>
            </div>
            <div className="stat bad">
              <b>{view.errors.length}</b>
              <span>с ошибками</span>
            </div>
          </div>

          {(pending || view.checked === 'server' || view.checked === 'local') && (
            <p className="check">
              {pending && 'Сверяю с сервером…'}
              {view.checked === 'server' && (
                <>
                  Проверено сервером
                  {view.serverFound > 0 && ` · колода изменилась, сервер нашёл дублей ещё: ${view.serverFound}`}
                </>
              )}
              {view.checked === 'local' && !pending && (
                <>
                  <span className="chip">проверено локально</span>{' '}
                  {deck.status === 'unknown'
                    ? 'Сервер не ответил, колода для сверки не загрузилась: дубли с колодой не проверены. Перед сохранением проверка повторится.'
                    : 'Сервер не ответил. Перед сохранением проверка повторится.'}
                </>
              )}
            </p>
          )}

          {view.checked === 'rejected' && (
            <div className="note warn" role="alert">
              <span>Сервер не принял файл: {view.rejection}</span>
            </div>
          )}

          {view.errors.length > 0 && (
            <section className="issues-block" aria-label="Строки с ошибками">
              <h3>Строки с ошибками</h3>
              <ul className="issues">
                {view.errors.slice(0, LIST_LIMIT).map((error) => (
                  <li className="issue" key={error.index}>
                    <span className="issue__row">строка {error.index + 1}</span>
                    <b className="issue__word">{error.word || '—'}</b>
                    <span className="issue__why">{error.messages.map(labelReason).join('; ')}</span>
                  </li>
                ))}
                <MoreRow shown={Math.min(LIST_LIMIT, view.errors.length)} total={view.errors.length} />
              </ul>
            </section>
          )}

          {view.duplicates.length > 0 && (
            <details className="issues-block">
              <summary>Пропущено как дубли: {view.duplicates.length}</summary>
              <ul className="issues">
                {view.duplicates.slice(0, LIST_LIMIT).map((dup) => (
                  <li className="issue" key={dup.index}>
                    <span className="issue__row">строка {dup.index + 1}</span>
                    <b className="issue__word">{dup.word}</b>
                    <span className="issue__why">{DUPLICATE_WHERE[dup.reason]}</span>
                  </li>
                ))}
                <MoreRow shown={Math.min(LIST_LIMIT, view.duplicates.length)} total={view.duplicates.length} />
              </ul>
            </details>
          )}

          <p className="sr-only" role="status">
            {pending ? '' : summary(view)}
          </p>
        </>
      )}
    </Modal>
  )
}
