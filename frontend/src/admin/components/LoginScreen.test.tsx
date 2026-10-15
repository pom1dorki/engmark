import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../fakeApi'
import { LoginScreen } from './LoginScreen'

afterEach(cleanup)

function setup() {
  const fake = createFakeApi({ authed: false, cards: [] })
  const onLoggedIn = vi.fn()
  render(<LoginScreen api={fake.api} onLoggedIn={onLoggedIn} />)
  const password = screen.getByLabelText('Пароль') as HTMLInputElement
  const submit = screen.getByRole('button', { name: 'Войти' }) as HTMLButtonElement
  return { fake, onLoggedIn, password, submit }
}

describe('LoginScreen', () => {
  it('asks for a password, hides it, and keeps the button off until something is typed', async () => {
    const { password, submit } = setup()
    expect(password.type).toBe('password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(submit.disabled).toBe(true)
    fireEvent.change(password, { target: { value: 'x' } })
    expect(submit.disabled).toBe(false)
  })

  it('signs in with the right password', async () => {
    const { fake, onLoggedIn, password } = setup()
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.submit(password.form as HTMLFormElement)
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1))
    expect(fake.callsOf('login')).toEqual([['secret']])
  })

  it('shows one message for a wrong password and keeps the field ready', async () => {
    const { onLoggedIn, password } = setup()
    fireEvent.change(password, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Неверный пароль или слишком много попыток. Подождите минуту.')
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(password.getAttribute('aria-describedby')).toBe(alert.id)
    expect(onLoggedIn).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(password))
  })

  it('says so when the admin is switched off on the server', async () => {
    const { fake, password } = setup()
    fake.failNext('login', { kind: 'not_found', message: 'not found' })
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('ADMIN_PASSWORD_HASH')
  })

  it('does not send an empty password', () => {
    const { fake, password } = setup()
    fireEvent.submit(password.form as HTMLFormElement)
    expect(fake.callsOf('login')).toHaveLength(0)
  })
})
