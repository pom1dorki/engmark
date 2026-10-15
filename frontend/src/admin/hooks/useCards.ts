import { useCallback, useEffect, useState } from 'react'
import type { AdminApi, ApiError, CardsQuery } from '../api/admin'
import { PAGE_SIZE } from '../rows'
import type { ServerCard } from '../types'
import { useLatest } from './useLatest'

interface Loaded {
  key: string
  items: ServerCard[]
  total: number
  revision: number
}

export interface CardsState {
  items: ServerCard[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  reload(): void
  loadMore(): void
}

export function useCards(api: AdminApi, query: CardsQuery | null, revision: number, epoch = 0): CardsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{ key: string; error: ApiError } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nonce, setNonce] = useState(0)
  const queryRef = useLatest(query)

  const key = query ? JSON.stringify([query, revision, nonce, epoch]) : 'none'

  useEffect(() => {
    const current = queryRef.current
    if (!current) return
    const controller = new AbortController()
    void api.cards({ ...current, limit: PAGE_SIZE, offset: 0 }, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) {
        setLoaded({ key, items: result.value.items, total: result.value.total, revision: result.value.revision })
        setFailure(null)
      } else if (result.error.kind !== 'aborted') {
        setFailure({ key, error: result.error })
      }
    })
    return () => controller.abort()
  }, [api, key, queryRef])

  const loadMore = useCallback(() => {
    const current = queryRef.current
    if (!current || !loaded || loaded.key !== key || loadingMore) return
    const { items, revision: pageRevision } = loaded
    setLoadingMore(true)
    void api.cards({ ...current, limit: PAGE_SIZE, offset: items.length }).then((result) => {
      setLoadingMore(false)
      if (!result.ok) {
        setFailure({ key, error: result.error })
        return
      }
      if (result.value.revision !== pageRevision) {
        setNonce((n) => n + 1)
        return
      }
      setFailure(null)
      setLoaded((prev) => (prev && prev.key === key ? { ...prev, items: [...prev.items, ...result.value.items], total: result.value.total } : prev))
    })
  }, [api, key, loaded, loadingMore, queryRef])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  if (!query) return { items: [], total: 0, loading: false, loadingMore: false, error: null, reload, loadMore }
  const failed = failure && failure.key === key ? failure.error : null
  return {
    items: loaded?.items ?? [],
    total: loaded?.total ?? 0,
    loading: loaded?.key !== key && failed === null,
    loadingMore,
    error: failed,
    reload,
    loadMore,
  }
}
