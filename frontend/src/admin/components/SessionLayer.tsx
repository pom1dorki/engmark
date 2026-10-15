import { useEffect, useId, useRef } from 'react'
import type { AdminApi } from '../api/admin'
import { trapTab } from '../hooks/focusTrap'
import { LoginForm } from './LoginForm'

interface Props {
  api: AdminApi
  onLoggedIn: () => void
}

export function SessionLayer({ api, onLoggedIn }: Props) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => opener?.focus()
  }, [])

  return (
    <div className="scrim scrim--top">
      <div ref={dialog} className="modal narrow" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => trapTab(event, dialog.current)}>
        <div className="mh">
          <h2 id={titleId}>Сессия закончилась</h2>
        </div>
        <div className="mb">
          <p className="mdesc">Войдите снова. Черновик и открытая карточка останутся на месте.</p>
          <LoginForm api={api} onLoggedIn={onLoggedIn} />
        </div>
      </div>
    </div>
  )
}
