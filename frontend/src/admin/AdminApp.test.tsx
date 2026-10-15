import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdminApp from './AdminApp'
import { DRAFT_KEY } from './draft/storage'
import { createFakeApi, seedCards } from './fakeApi'
import { readFrontendFile } from './testkit'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

const bodyRows = () => screen.queryAllByRole('row').slice(1)

describe('AdminApp', () => {
  it('opens the workspace when the session is valid', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    expect(screen.getByRole('heading', { name: 'Engmark · Администрирование' })).toBeTruthy()
    await screen.findByRole('heading', { name: 'Слова' })
    await waitFor(() => expect(bodyRows()).toHaveLength(50))
    expect(screen.queryByLabelText('Пароль')).toBeNull()
  })

  it('asks for the password first, rejects a wrong one and lets the right one in', async () => {
    const fake = createFakeApi({ cards: seedCards(60), authed: false })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    const password = await screen.findByLabelText('Пароль')
    expect(screen.getByRole('heading', { name: 'Вход в админку' })).toBeTruthy()

    fireEvent.change(password, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: 'Слова' })).toBeNull()

    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await screen.findByRole('heading', { name: 'Слова' })
    await waitFor(() => expect(bodyRows()).toHaveLength(50))
  })

  it('says the admin is switched off when the server has no password configured', async () => {
    const fake = createFakeApi({ cards: [] })
    fake.failNext('session', { kind: 'not_found', message: 'not found' })
    render(<AdminApp api={fake.api} />)
    expect(await screen.findByRole('heading', { name: 'Админка выключена' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('ADMIN_PASSWORD_HASH')
  })

  it('shows a connection problem and checks the session again on retry', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    fake.failNext('session', { kind: 'network' })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    expect(await screen.findByRole('heading', { name: 'Нет связи с сервером' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Слова' })
    expect(fake.callsOf('session')).toHaveLength(2)
  })

  it('puts the sign-in over the workspace when the session expires: the open card and the draft stay where they were', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    render(<AdminApp api={fake.api} pollMs={40} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(50))

    fireEvent.click(screen.getByRole('row', { name: /^ba / }))
    const translation = await screen.findByLabelText('Перевод')
    fireEvent.change(translation, { target: { value: 'новый перевод' } })
    fireEvent.keyDown(translation, { key: 'Enter', ctrlKey: true })
    await screen.findByText('Правки «ba» в черновике · основа v1')

    fireEvent.click(screen.getByRole('row', { name: /^ko / }))
    await waitFor(() => expect((screen.getByLabelText('Перевод') as HTMLInputElement).value).not.toBe('новый перевод'))
    fireEvent.change(screen.getByLabelText('Перевод'), { target: { value: 'ещё не в черновике' } })

    fake.setAuthed(false)
    const layer = await screen.findByRole('dialog', { name: 'Сессия закончилась' })
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(screen.getByRole('heading', { name: 'Слова' })).toBeTruthy()
    expect(document.querySelector('.shell')?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Вход в админку' })).toBeNull()

    fireEvent.change(within(layer).getByLabelText('Пароль'), { target: { value: 'wrong' } })
    fireEvent.click(within(layer).getByRole('button', { name: 'Войти' }))
    await within(layer).findByRole('alert')

    fireEvent.change(within(layer).getByLabelText('Пароль'), { target: { value: 'secret' } })
    fireEvent.click(within(layer).getByRole('button', { name: 'Войти' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Сессия закончилась' })).toBeNull())
    expect(document.querySelector('.shell')?.hasAttribute('inert')).toBe(false)
    expect((screen.getByLabelText('Перевод') as HTMLInputElement).value).toBe('ещё не в черновике')
    expect((await screen.findByRole('region', { name: 'Черновик' })).textContent).toContain('1 изменено')
  })

  it('continues a save that the expired session interrupted: the same window, the same comment, the draft is intact', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(50))

    fireEvent.click(screen.getByRole('row', { name: /^ba / }))
    const translation = await screen.findByLabelText('Перевод')
    fireEvent.change(translation, { target: { value: 'новый перевод' } })
    fireEvent.keyDown(translation, { key: 'Enter', ctrlKey: true })
    await screen.findByText('Правки «ba» в черновике · основа v1')

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    fireEvent.change(screen.getByLabelText('Комментарий к ревизии'), { target: { value: 'Мой комментарий' } })
    fake.setAuthed(false)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Сохранить изменения' })).getByRole('button', { name: 'Сохранить' }))

    const layer = await screen.findByRole('dialog', { name: 'Сессия закончилась' })
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')
    expect(fake.callsOf('save')).toHaveLength(1)
    expect(fake.revisionLog()).toHaveLength(0)

    fireEvent.change(within(layer).getByLabelText('Пароль'), { target: { value: 'secret' } })
    fireEvent.click(within(layer).getByRole('button', { name: 'Войти' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Сессия закончилась' })).toBeNull())
    const dialog = screen.getByRole('dialog', { name: 'Сохранить изменения' })
    expect((within(dialog).getByLabelText('Комментарий к ревизии') as HTMLInputElement).value).toBe('Мой комментарий')
    expect(within(dialog).getByRole('status').textContent).toContain('Вы снова вошли, черновик на месте')
    expect(fake.callsOf('save')).toHaveLength(1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Сохранено как r2. Каталог для учеников обновлён')
    expect(fake.revisionLog()[0]).toMatchObject({ revision: 2, message: 'Мой комментарий' })
    expect(fake.card(101).translation).toBe('новый перевод')
  })

  it('signs out with «Выйти», shows the sign-in page and brings the draft back after the next sign-in', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(50))
    fireEvent.click(screen.getByRole('row', { name: /^ba / }))
    const translation = await screen.findByLabelText('Перевод')
    fireEvent.change(translation, { target: { value: 'новый перевод' } })
    fireEvent.keyDown(translation, { key: 'Enter', ctrlKey: true })
    await screen.findByText('Правки «ba» в черновике · основа v1')

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(await screen.findByRole('heading', { name: 'Вход в админку' })).toBeTruthy()
    expect(fake.callsOf('logout')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toContain('новый перевод')

    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect((await screen.findByRole('region', { name: 'Черновик' })).textContent).toContain('1 изменено')
  })

  it('stays in the workspace and says so when signing out fails', async () => {
    const fake = createFakeApi({ cards: seedCards(60) })
    render(<AdminApp api={fake.api} pollMs={600_000} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(50))
    fake.failNext('logout', { kind: 'network' })
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    expect((await screen.findAllByText('Не удалось выйти: Нет связи с сервером.')).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Слова' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Выйти' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('admin.html', () => {
  const html = readFrontendFile('admin.html')

  it('has no inline scripts or styles', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attrs, body] of scripts) {
      expect(attrs).toContain('src=')
      expect(body.trim()).toBe('')
    }
    expect(html).not.toMatch(/<style\b/)
    expect(html).not.toMatch(/\sstyle=/)
    expect(html).not.toMatch(/\son[a-z]+=/)
  })

  it('is not indexable', () => {
    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex"/)
  })

  it('loads only the admin entry', () => {
    expect(html).toContain('/src/admin/main.tsx')
    expect(html).not.toContain('/src/main.tsx')
  })
})
