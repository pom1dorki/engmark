import type { ToastMessage } from '../hooks/useToast'
import { Icon } from './Icon'

export function ToastRegion({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className={toast.kind === 'error' ? 'toast error' : 'toast'} key={toast.id}>
          <span>{toast.text}</span>
          {toast.kind === 'error' && (
            <button type="button" className="btn ghost small" aria-label="Закрыть сообщение" onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
