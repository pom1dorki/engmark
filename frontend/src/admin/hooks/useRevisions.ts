import { useCallback, useEffect, useState } from 'react'
import type { AdminApi, ApiError } from '../api/admin'
import { REVISIONS_PAGE, hasOlderRevisions, mergeRevisions } from '../history'
import type { RevisionInfo } from '../types'

export interface RevisionsState {
  items: RevisionInfo[]
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  hasMore: boolean
  reload(): void
  loadMore(): void
}

export function useRevisions(api: AdminApi, deckRevision: number): RevisionsState {
  const [items, setItems] = useState<RevisionInfo[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void api.revisions({ limit: REVISIONS_PAGE }, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) {
        setItems((prev) => mergeRevisions(prev, result.value.items))
        setError(null)
        setLoaded(true)
      } else if (result.error.kind !== 'aborted') {
        setError(result.error)
      }
    })
    return () => controller.abort()
  }, [api, deckRevision, nonce])

  const loadMore = useCallback(() => {
    const oldest = items[items.length - 1]
    if (!oldest || loadingMore || !hasOlderRevisions(items)) return
    setLoadingMore(true)
    void api.revisions({ limit: REVISIONS_PAGE, before: oldest.revision }).then((result) => {
      setLoadingMore(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setItems((prev) => mergeRevisions(prev, result.value.items))
    })
  }, [api, items, loadingMore])

  const reload = useCallback(() => {
    setError(null)
    setNonce((n) => n + 1)
  }, [])

  return { items, loading: !loaded && error === null, loadingMore, error, hasMore: hasOlderRevisions(items), reload, loadMore }
}
