import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { trapTab } from '../hooks/focusTrap'
import { Icon } from './Icon'

interface Props {
  title: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
}

export function Modal({ title, onClose, footer, children }: Props) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    return () => opener?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    trapTab(event, dialog.current)
  }

  const onScrimDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className="scrim" onMouseDown={onScrimDown}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="mh">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn ghost icon" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="mb">{children}</div>
        <div className="mf">{footer}</div>
      </div>
    </div>
  )
}
