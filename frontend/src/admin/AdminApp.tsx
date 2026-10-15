import { useCallback, useEffect, useMemo, useState } from 'react'
import { type AdminApi, createAdminApi, describeError } from './api/admin'
import { watchAuth } from './api/watchAuth'
import { BootScreen } from './components/BootScreen'
import { LoginScreen } from './components/LoginScreen'
import { SessionLayer } from './components/SessionLayer'
import Workspace from './components/Workspace'

type Phase = { name: 'checking' } | { name: 'login' } | { name: 'in' } | { name: 'expired' } | { name: 'disabled' } | { name: 'offline'; message: string }

interface Props {
  api?: AdminApi
  pollMs?: number
}

export default function AdminApp({ api: injected, pollMs }: Props) {
  const [base] = useState(() => injected ?? createAdminApi())
  const [phase, setPhase] = useState<Phase>({ name: 'checking' })
  const [attempt, setAttempt] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const api = useMemo(() => watchAuth(base, () => setPhase((prev) => (prev.name === 'in' ? { name: 'expired' } : prev))), [base])

  useEffect(() => {
    const controller = new AbortController()
    void base.session({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setPhase({ name: 'in' })
      else if (result.error.kind === 'unauthenticated') setPhase({ name: 'login' })
      else if (result.error.kind === 'not_found') setPhase({ name: 'disabled' })
      else if (result.error.kind !== 'aborted') setPhase({ name: 'offline', message: describeError(result.error) })
    })
    return () => controller.abort()
  }, [base, attempt])

  const logout = useCallback(async (): Promise<string | null> => {
    const result = await base.logout()
    if (result.ok || result.error.kind === 'unauthenticated') {
      setPhase({ name: 'login' })
      return null
    }
    return describeError(result.error)
  }, [base])

  switch (phase.name) {
    case 'checking':
      return <BootScreen title="Engmark · Администрирование" text="Проверяю вход…" />
    case 'disabled':
      return <BootScreen title="Админка выключена" text="На сервере не задан ADMIN_PASSWORD_HASH. Задайте его в .env и перезапустите приложение." isError />
    case 'offline':
      return (
        <BootScreen
          title="Нет связи с сервером"
          text={phase.message}
          isError
          onRetry={() => {
            setPhase({ name: 'checking' })
            setAttempt((n) => n + 1)
          }}
        />
      )
    case 'login':
      return <LoginScreen api={api} onLoggedIn={() => setPhase({ name: 'in' })} />
    case 'in':
    case 'expired':
      return (
        <>
          <div className="shell" inert={phase.name === 'expired'}>
            <Workspace api={api} pollMs={pollMs} epoch={epoch} onLogout={logout} />
          </div>
          {phase.name === 'expired' && (
            <SessionLayer
              api={api}
              onLoggedIn={() => {
                setEpoch((n) => n + 1)
                setPhase({ name: 'in' })
              }}
            />
          )}
        </>
      )
  }
}
