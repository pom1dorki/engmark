import { useRef, useState } from 'react'
import { type AdminApi, describeError } from '../api/admin'
import { downloadText } from '../download'
import { exportFileName, revisionFromEtag } from '../history'

export type ExportTarget = 'current' | number

export function useExport(api: AdminApi, deckRevision: number, onToast: (text: string, kind?: 'info' | 'error') => void, saveFile: (name: string, text: string) => void = downloadText) {
  const [busy, setBusy] = useState<ExportTarget | null>(null)
  const running = useRef(false)

  const run = async (target: ExportTarget, note = '') => {
    if (running.current) return
    running.current = true
    setBusy(target)
    try {
      const result = target === 'current' ? await api.exportCurrent() : await api.exportRevision(target)
      if (!result.ok) {
        onToast(`Не удалось скачать: ${describeError(result.error)}`, 'error')
        return
      }
      const revision = target === 'current' ? (revisionFromEtag(result.etag) ?? deckRevision) : target
      const name = exportFileName(revision)
      saveFile(name, result.value)
      onToast(`Скачан файл ${name}${note}`)
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  return { busy, run }
}
