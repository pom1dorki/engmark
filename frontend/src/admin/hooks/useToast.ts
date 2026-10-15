import { useCallback, useEffect, useState } from 'react'

export interface ToastMessage {
  id: number
  text: string
  kind: 'info' | 'error'
}

export const TOAST_MS = 4000

export function useToast(ms: number = TOAST_MS) {
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => {
    if (!toast || toast.kind === 'error') return
    const timer = setTimeout(() => setToast(null), ms)
    return () => clearTimeout(timer)
  }, [toast, ms])

  const show = useCallback((text: string, kind: ToastMessage['kind'] = 'info') => {
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, text, kind }))
  }, [])
  const hide = useCallback(() => setToast(null), [])
  return { toast, show, hide }
}
