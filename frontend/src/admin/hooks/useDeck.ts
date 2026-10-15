import { useEffect, useState } from 'react'
import type { AdminApi, ApiError } from '../api/admin'
import type { DeckInfo } from '../types'

export const DECK_POLL_MS = 30_000

interface DeckState {
  deck: DeckInfo | null
  error: ApiError | null
}

export function useDeck(api: AdminApi, pollMs: number = DECK_POLL_MS, epoch = 0) {
  const [state, setState] = useState<DeckState>({ deck: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      void api.deck({ signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return
        if (result.ok) {
          setState((prev) => (prev.deck === result.value && prev.error === null ? prev : { deck: result.value, error: null }))
        } else if (result.error.kind !== 'aborted') {
          setState((prev) => ({ ...prev, error: result.error }))
        }
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    load()
    const timer = setInterval(load, pollMs)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', load)
    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', load)
    }
  }, [api, pollMs, attempt, epoch])

  return { deck: state.deck, error: state.error, retry: () => setAttempt((n) => n + 1) }
}
