import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { type Draft, type DraftAction, draftReducer, emptyDraft, isDraftEmpty } from './draft'
import { useLatest } from '../hooks/useLatest'
import { DRAFT_KEY, type DraftNotice, loadDraft, saveDraft } from './storage'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const nullStorage: DraftStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }

function browserStorage(): DraftStorage {
  try {
    return window.localStorage
  } catch {
    return nullStorage
  }
}

export function useDraft(deckId: number, serverRevision: number, storage: DraftStorage = browserStorage(), onSaveFailed?: () => void) {
  const [initial] = useState(() => loadDraft(storage, deckId))
  const [notice, setNotice] = useState<DraftNotice | null>(initial.notice)
  const [externalChange, setExternalChange] = useState(false)

  const reducer = useCallback(
    (state: Draft, action: DraftAction): Draft => {
      const synced = isDraftEmpty(state) && state.baseRevision !== serverRevision ? { ...state, baseRevision: serverRevision } : state
      return draftReducer(synced, action)
    },
    [serverRevision],
  )
  const [stored, dispatch] = useReducer(reducer, undefined, () => initial.draft ?? emptyDraft(deckId, serverRevision))

  const draft = useMemo(
    () => (isDraftEmpty(stored) && stored.baseRevision !== serverRevision ? { ...stored, baseRevision: serverRevision } : stored),
    [stored, serverRevision],
  )

  const failedRef = useLatest(onSaveFailed)
  const failing = useRef(false)
  useEffect(() => {
    if (externalChange) return
    const saved = saveDraft(storage, draft)
    if (!saved && !failing.current) failedRef.current?.()
    failing.current = !saved
  }, [draft, externalChange, storage, failedRef])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === DRAFT_KEY || event.key === null) setExternalChange(true)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const acceptExternal = useCallback(() => {
    const { draft: external } = loadDraft(storage, deckId)
    dispatch({ type: 'replace', draft: external ?? emptyDraft(deckId, serverRevision) })
    setExternalChange(false)
  }, [deckId, serverRevision, storage])

  const keepMine = useCallback(() => {
    saveDraft(storage, draft)
    setExternalChange(false)
  }, [draft, storage])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return { draft, dispatch, notice, dismissNotice, externalChange, acceptExternal, keepMine }
}
