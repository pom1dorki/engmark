import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { AdminApi } from '../api/admin'
import { describeLoginError } from '../labels'

interface Props {
  api: AdminApi
  onLoggedIn: () => void
}

export function LoginForm({ api, onLoggedIn }: Props) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || password === '') return
    setBusy(true)
    setError(null)
    const result = await api.login(password)
    setBusy(false)
    if (result.ok) {
      setPassword('')
      onLoggedIn()
    } else {
      setError(describeLoginError(result.error))
      inputRef.current?.focus()
    }
  }

  return (
    <form className="login" onSubmit={submit} noValidate>
      <div className={error ? 'f err' : 'f'}>
        <label htmlFor="admin-password">Пароль</label>
        <input
          id="admin-password"
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'admin-password-error' : undefined}
        />
        {error && (
          <span id="admin-password-error" className="hint login__error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button type="submit" className="btn pri" disabled={busy || password === ''}>
        {busy ? 'Проверяю…' : 'Войти'}
      </button>
    </form>
  )
}
