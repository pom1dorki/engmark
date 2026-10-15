import { useEffect, useMemo, useRef, useState } from 'react'
import { type AdminApi, describeError } from '../api/admin'
import { BootScreen } from './BootScreen'
import { CardEditor } from './CardEditor'
import { ConflictDialog } from './ConflictDialog'
import { DraftBar } from './DraftBar'
import { Header } from './Header'
import { HistoryView } from './HistoryView'
import { ImportDialog } from './ImportDialog'
import { type ProblemLine, DraftNotices, RevisionBanner, SaveProblems } from './Notices'
import { RevertDialog } from './RevertDialog'
import { SaveDialog } from './SaveDialog'
import { type View, Sidebar } from './Sidebar'
import { ToastRegion } from './Toast'
import { WordsView } from './WordsView'
import { type DraftImport, isDraftEmpty } from '../draft/draft'
import { useDraft } from '../draft/useDraft'
import { type EditorTarget, targetForKey, targetKey } from '../editorModel'
import { useBeforeUnload } from '../hooks/useBeforeUnload'
import { useCards } from '../hooks/useCards'
import { useDebounced } from '../hooks/useDebounced'
import { useDeck } from '../hooks/useDeck'
import { useExport } from '../hooks/useExport'
import { useLatest } from '../hooks/useLatest'
import { useRevert } from '../hooks/useRevert'
import { useSave } from '../hooks/useSave'
import { useSlashFocus } from '../hooks/useSlashFocus'
import { useToast } from '../hooks/useToast'
import { mergeDraft } from '../merge/merge'
import { type ListFilters, type Row, type StateFilter, buildRows, importGroups, serverQuery } from '../rows'
import { type ProblemState, activeProblems, createdIds, firstCardProblem, isImportProblemKey, markProblems, problemLabel, savedMessage } from '../saveFlow'
import type { DeckInfo } from '../types'

interface WorkspaceProps {
  api: AdminApi
  pollMs?: number
  epoch?: number
  onLogout?: () => Promise<string | null>
  saveFile?: (name: string, text: string) => void
}

export default function Workspace({ api, pollMs, epoch = 0, onLogout, saveFile }: WorkspaceProps) {
  const { deck, error, retry } = useDeck(api, pollMs, epoch)
  if (!deck) {
    return error ? (
      <BootScreen title="Не удалось загрузить колоду" text={describeError(error)} isError onRetry={retry} />
    ) : (
      <BootScreen title="Engmark · Администрирование" text="Загрузка колоды…" />
    )
  }
  return <Desk api={api} deck={deck} offline={error !== null && error.kind !== 'unauthenticated'} refreshDeck={retry} epoch={epoch} onLogout={onLogout} saveFile={saveFile} />
}

interface RebaseState {
  busy: boolean
  conflictWords: string[] | null
}

interface DeskProps {
  api: AdminApi
  deck: DeckInfo
  offline: boolean
  refreshDeck: () => void
  epoch: number
  onLogout?: () => Promise<string | null>
  saveFile?: (name: string, text: string) => void
}

function Desk({ api, deck, offline, refreshDeck, epoch, onLogout, saveFile }: DeskProps) {
  const { toast, show, hide } = useToast()
  const onSaveFailed = () => show('Черновик не помещается в память браузера: после перезагрузки страницы он пропадёт. Сохраните изменения на сервере.', 'error')
  const { draft, dispatch, notice, dismissNotice, externalChange, acceptExternal, keepMine } = useDraft(deck.id, deck.revision, undefined, onSaveFailed)
  const [view, setView] = useState<View>('words')
  const [queryText, setQueryText] = useState('')
  const [pos, setPos] = useState('')
  const [state, setState] = useState<StateFilter>('active')
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const [rebase, setRebase] = useState<RebaseState>({ busy: false, conflictWords: null })
  const [importOpen, setImportOpen] = useState(false)
  const [problemState, setProblemState] = useState<ProblemState | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const draftRef = useLatest(draft)
  const targetRef = useLatest(target)

  const q = useDebounced(queryText, 200)
  const filters = useMemo<ListFilters>(() => ({ q, pos, state }), [q, pos, state])
  const query = useMemo(() => serverQuery(filters), [filters])
  const cards = useCards(api, query, deck.revision, epoch)
  const rows = useMemo(() => buildRows(cards.items, draft, filters), [cards.items, draft, filters])
  const groups = useMemo(() => importGroups(draft.imports, filters), [draft.imports, filters])

  const draftActive = !isDraftEmpty(draft)
  useSlashFocus(searchRef)
  useBeforeUnload(draftActive)

  useEffect(() => {
    if (target !== null) return
    opener.current?.focus()
    opener.current = null
  }, [target])

  const open = (next: EditorTarget) => {
    if (target === null) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTarget(next)
  }
  const openRow = (row: Row) => open(row.id === null ? { kind: 'create', key: row.key } : { kind: 'card', id: row.id })
  const close = () => setTarget(null)

  const restoreRow = (row: Row) => {
    if (row.id === null || row.version === null) return
    dispatch({ type: 'restore', id: row.id, baseVersion: row.version, base: row.card })
    show(`«${row.card.word}» вернётся из архива`)
  }

  const addImport = (file: DraftImport) => {
    dispatch({ type: 'addImport', file })
    setImportOpen(false)
    show(`Из файла «${file.fileName}» в черновик добавлено: ${file.cards.length}`)
  }

  const removeImport = (index: number) => {
    const file = draft.imports[index]
    dispatch({ type: 'removeImport', index })
    if (file) show(`Файл «${file.fileName}» убран из черновика`)
  }

  const changeView = (next: View) => {
    setView(next)
    setTarget(null)
    if (next === 'history') refreshDeck()
  }

  const refreshBase = async () => {
    const started = draft
    setRebase({ busy: true, conflictWords: null })
    const result = await api.changes(started.baseRevision)
    if (!result.ok) {
      setRebase({ busy: false, conflictWords: null })
      show(`Не удалось обновить основу: ${describeError(result.error)}`, 'error')
      return
    }
    if (draftRef.current !== started) {
      setRebase({ busy: false, conflictWords: null })
      show('Черновик изменился, пока шла загрузка. Нажмите ещё раз.', 'error')
      return
    }
    const merged = mergeDraft(started, result.value)
    if (merged.conflicts.length > 0) {
      const words = [...new Set(merged.conflicts.map((conflict) => conflict.word))]
      setRebase({ busy: false, conflictWords: words })
      return
    }
    dispatch({ type: 'rebase', baseRevision: merged.rebasedDraft.baseRevision, items: merged.rebasedDraft.items })
    setRebase({ busy: false, conflictWords: null })
    const fields = merged.autoMerged.reduce((sum, item) => sum + item.fields.length, 0)
    show(`Основа обновлена до r${merged.rebasedDraft.baseRevision}${fields > 0 ? ` · с сервера подтянуто полей: ${fields}` : ''}`)
  }

  const save = useSave({
    api,
    draft,
    dispatch,
    epoch,
    onSaved: (outcome) => {
      setProblemState(null)
      dispatch({ type: 'discardAll' })
      const current = targetRef.current
      if (current?.kind === 'create') {
        const id = createdIds(outcome.built, outcome.result)[current.key]
        setTarget(id === undefined ? null : { kind: 'card', id })
      }
      show(savedMessage(outcome))
      refreshDeck()
    },
    onRejected: (rejection, saved) => {
      setProblemState(markProblems(saved, rejection))
      const first = firstCardProblem(rejection.problems)
      if (!first) return false
      setView('words')
      setState('draft')
      open(targetForKey(first.key))
      return true
    },
    onLater: () => {
      refreshDeck()
      show('Ничего не записано. Черновик остался на прежней основе: обновите её или сохраните снова.')
    },
    onNothingLeft: (revision) => {
      setProblemState(null)
      refreshDeck()
      show(`Все ваши правки уже есть на сервере (r${revision}), сохранять нечего`)
    },
  })

  const exporter = useExport(api, deck.revision, show, saveFile)
  const exportDeck = () => void exporter.run('current', draftActive ? '. Черновик в файл не входит.' : '')
  const reverter = useRevert({
    api,
    deckId: deck.id,
    draft,
    dispatch,
    onToast: show,
    onReady: () => {
      setProblemState(null)
      setView('words')
      setState('draft')
      setTarget(null)
    },
  })

  const openVersion = (cardId: number, version: number) => {
    setView('words')
    open({ kind: 'card', id: cardId, version })
  }

  const logout = async () => {
    if (!onLogout || loggingOut) return
    setLoggingOut(true)
    const problem = await onLogout()
    if (problem !== null) {
      setLoggingOut(false)
      show(`Не удалось выйти: ${problem}`, 'error')
    }
  }

  const active = activeProblems(problemState, draft)
  const problemMap: Record<string, string[]> = Object.fromEntries(active.problems.map((problem) => [problem.key, problem.messages]))
  const problemLines: ProblemLine[] = active.problems.map((problem) => ({
    key: problem.key,
    label: problemLabel(draft, problem.key),
    messages: problem.messages,
    openable: !isImportProblemKey(problem.key),
  }))

  const editorOpen = view === 'words' && target !== null
  const behind = draftActive && deck.revision > draft.baseRevision

  return (
    <>
      <div className={editorOpen ? 'app drawer-open' : 'app'}>
        <Sidebar view={view} onView={changeView} deck={deck} offline={offline} onLogout={onLogout ? () => void logout() : undefined} loggingOut={loggingOut} />
        <main className="main">
          <Header
            view={view}
            deckTitle={deck.title}
            baseRevision={draft.baseRevision}
            exporting={exporter.busy === 'current'}
            onNew={() => open({ kind: 'new' })}
            onImport={() => setImportOpen(true)}
            onExport={exportDeck}
          />
          <DraftNotices notice={notice} onDismiss={dismissNotice} externalChange={externalChange} onAcceptExternal={acceptExternal} onKeepMine={keepMine} />
          {behind && (
            <RevisionBanner
              serverRevision={deck.revision}
              baseRevision={draft.baseRevision}
              busy={rebase.busy}
              conflictWords={rebase.conflictWords}
              onRefresh={() => void refreshBase()}
            />
          )}
          {save.state.step === 'closed' && (problemLines.length > 0 || active.general.length > 0) && (
            <SaveProblems items={problemLines} general={active.general} onOpen={(key) => open(targetForKey(key))} onDismiss={() => setProblemState(null)} />
          )}
          <div className="body">
            {view === 'words' ? (
              <WordsView
                filters={filters}
                queryText={queryText}
                onQueryText={setQueryText}
                onPos={setPos}
                onState={setState}
                searchRef={searchRef}
                rows={rows}
                groups={groups}
                cards={cards}
                selectedKey={target ? targetKey(target) : null}
                problems={problemMap}
                onOpen={openRow}
                onRestore={restoreRow}
                onRemoveImport={removeImport}
              />
            ) : (
              <HistoryView
                api={api}
                deck={deck}
                exporting={exporter.busy}
                reverting={reverter.busy}
                onExport={(revision) => void exporter.run(revision)}
                onRevert={reverter.request}
                onOpenVersion={openVersion}
              />
            )}
            {editorOpen && target && (
              <CardEditor key={targetKey(target) ?? 'new'} api={api} target={target} draft={draft} dispatch={dispatch} onClose={close} onToast={show} />
            )}
          </div>
        </main>
      </div>
      {importOpen && <ImportDialog api={api} draft={draft} onAdd={addImport} onClose={() => setImportOpen(false)} />}
      {save.state.step === 'review' && (
        <SaveDialog
          draft={draft}
          message={save.state.message}
          onMessage={save.setMessage}
          busy={save.state.busy}
          failure={save.state.failure}
          resumed={save.state.resumed}
          problems={problemMap}
          onSave={save.save}
          onClose={save.close}
        />
      )}
      {save.state.step === 'conflict' && (
        <ConflictDialog
          key={save.state.id}
          merge={save.state.merge}
          baseRevision={save.state.baseRevision}
          serverRevision={save.state.serverRevision}
          busy={save.state.busy}
          onApply={save.apply}
          onLater={save.later}
        />
      )}
      {reverter.confirming !== null && <RevertDialog revision={reverter.confirming} draft={draft} onConfirm={reverter.confirm} onCancel={reverter.cancel} />}
      {draftActive && <DraftBar draft={draft} serverRevision={deck.revision} onReview={save.open} onSave={save.open} onDiscardAll={() => dispatch({ type: 'discardAll' })} />}
      <ToastRegion toast={toast} onClose={hide} />
    </>
  )
}
