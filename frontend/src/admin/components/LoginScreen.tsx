import type { AdminApi } from '../api/admin'
import { LoginForm } from './LoginForm'

interface Props {
  api: AdminApi
  onLoggedIn: () => void
}

export function LoginScreen({ api, onLoggedIn }: Props) {
  return (
    <main className="admin-boot">
      <div className="admin-boot__logo" aria-hidden="true">
        E
      </div>
      <h1 className="admin-boot__title">Вход в админку</h1>
      <LoginForm api={api} onLoggedIn={onLoggedIn} />
    </main>
  )
}
