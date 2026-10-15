import { useRef, useState } from 'react'
import { type AdminApi, describeError } from '../api/admin'
import { type Draft, type DraftAction, isDraftEmpty } from '../draft/draft'
import { prepareRevert, revertSummary } from '../revert'
import { useLatest } from './useLatest'

interface Options {
  api: AdminApi
  deckId: number
  draft: Draft
  dispatch: (action: DraftAction) => void
  onReady: (draft: Draft) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
}

export function useRevert(options: Options) {
  const latest = useLatest(options)
  const running = useRef(false)
  const [asking, setAsking] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const build = async (rev: number) => {
    if (running.current) return
    running.current = true
    setBusy(rev)
    try {
      const { api, deckId, dispatch, onReady, onToast } = latest.current
      const result = await prepareRevert(api, deckId, rev)
      switch (result.kind) {
        case 'draft':
          dispatch({ type: 'replace', draft: result.draft })
          onReady(result.draft)
          onToast(`Откат к r${rev} собран в черновик: ${revertSummary(result.draft)}. Проверьте и сохраните.`)
          return
        case 'nothing':
          onToast(`Колода уже совпадает с r${rev}, откатывать нечего`)
          return
        case 'stale':
          onToast('Колода изменилась, пока собирался откат. Ничего не тронуто, нажмите «Откатить» ещё раз.', 'error')
          return
        case 'error':
          onToast(`Не удалось собрать откат: ${describeError(result.error)}`, 'error')
          return
      }
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  return {
    confirming: asking,
    busy,
    request(rev: number) {
      if (running.current) return
      if (isDraftEmpty(latest.current.draft)) void build(rev)
      else setAsking(rev)
    },
    confirm() {
      const rev = asking
      setAsking(null)
      if (rev !== null) void build(rev)
    },
    cancel() {
      setAsking(null)
    },
  }
}
