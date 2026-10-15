import { useEffect, useState } from 'react'
import type { AdminApi } from '../api/admin'
import type { ServerCard } from '../types'
import { useDebounced } from './useDebounced'

export function useDuplicateMatches(api: AdminApi, word: string, enabled: boolean): ServerCard[] {
  const debounced = useDebounced(word.trim().toLowerCase(), 300)
  const [found, setFound] = useState<ServerCard[]>([])

  useEffect(() => {
    if (!enabled || debounced === '') return
    const controller = new AbortController()
    void api.cards({ q: debounced, state: 'active', limit: 200 }, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.ok) setFound(result.value.items)
    })
    return () => controller.abort()
  }, [api, debounced, enabled])

  return found
}
