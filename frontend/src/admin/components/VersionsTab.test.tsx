import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FakeApi, createFakeApi, seedCards } from '../fakeApi'
import type { CardVersion } from '../types'
import { VersionsTab } from './VersionsTab'

afterEach(cleanup)

function history(): FakeApi {
  const fake = createFakeApi({ cards: seedCards(10), revision: 1 })
  fake.editCard(101, { translation: 'второй перевод' })
  fake.editCard(101, { translation: 'третий перевод', usage: 'Новый контекст.' })
  return fake
}

function setup(options: { fake?: FakeApi; lockedReason?: string | null; initialVersion?: number | null } = {}) {
  const fake = options.fake ?? history()
  const onTake = vi.fn<(version: CardVersion) => void>()
  render(<VersionsTab api={fake.api} cardId={101} lockedReason={options.lockedReason ?? null} initialVersion={options.initialVersion ?? null} onTake={onTake} />)
  return { fake, onTake }
}

async function rows() {
  let list: HTMLElement | null = null
  await waitFor(() => {
    list = screen.getByRole('list', { name: 'Версии карточки, новые сверху' })
  })
  return Array.from((list as unknown as HTMLElement).children) as HTMLElement[]
}

const head = (n: number) => screen.getByRole('button', { name: new RegExp(`^v${n} `) })

describe('VersionsTab', () => {
  it('lists the versions newest first with their revision and marks the current one', async () => {
    setup()
    expect(screen.getByRole('status').textContent).toBe('Загрузка версий…')
    const items = await rows()
    expect(items.map((item) => item.querySelector('.ver')?.textContent)).toEqual(['v3', 'v2', 'v1'])
    expect(items[0].textContent).toContain('r3')
    expect(within(items[0]).getByText('текущая')).toBeTruthy()
    expect(within(items[2]).queryByText('текущая')).toBeNull()
    expect(items[2].textContent).toContain('r1')
  })

  it('shows only the fields that differ from the current version and takes the old values on request', async () => {
    const { onTake } = setup()
    await rows()
    const toggle = head(1)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const table = screen.getByRole('table', { name: 'Чем v1 отличается от текущей версии v3' })
    const lines = within(table).getAllByRole('row').map((row) => row.textContent)
    expect(lines).toEqual(['Полеv1Сейчас · v3', 'Переводперевод 1третий перевод', 'Контекст и стильКонтекст.Новый контекст.'])

    fireEvent.click(screen.getByRole('button', { name: 'Взять значения из v1' }))
    expect(onTake).toHaveBeenCalledTimes(1)
    expect(onTake.mock.calls[0][0]).toMatchObject({ version: 1, card: { translation: 'перевод 1', usage: 'Контекст.' } })
  })

  it('says that the current version is the reference and offers nothing to take from it', async () => {
    setup()
    await rows()
    fireEvent.click(head(3))
    expect(screen.getByText('Это текущая версия. Остальные сравниваются с ней.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Взять значения/ })).toBeNull()
  })

  it('does not offer to take a version whose fields are the same, and warns about an archived one', async () => {
    const fake = createFakeApi({ cards: seedCards(10), revision: 1 })
    fake.archiveCard(101)
    fake.editCard(101, { translation: 'после архива' })
    fake.editCard(101, { translation: 'перевод 1' })
    setup({ fake })
    await rows()
    fireEvent.click(head(2))
    expect(screen.getByText(/В этой версии карточка была в архиве/)).toBeTruthy()
    expect(screen.getByText('Значения полей такие же, как в текущей версии v4.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Взять значения из v2' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains why values cannot be taken while the card is locked', async () => {
    const { onTake } = setup({ lockedReason: 'Карточка в архиве: верните её из архива, чтобы править.' })
    await rows()
    fireEvent.click(head(2))
    const take = screen.getByRole('button', { name: 'Взять значения из v2' }) as HTMLButtonElement
    expect(take.disabled).toBe(true)
    expect(screen.getByText('Карточка в архиве: верните её из архива, чтобы править.')).toBeTruthy()
    fireEvent.click(take)
    expect(onTake).not.toHaveBeenCalled()
  })

  it('opens the version a link pointed to and puts the focus on it', async () => {
    setup({ initialVersion: 2 })
    await rows()
    expect(head(2).getAttribute('aria-expanded')).toBe('true')
    expect(head(1).getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(document.activeElement).toBe(head(2)))
  })

  it('says why the versions did not load and tries again', async () => {
    const fake = history()
    fake.failNext('cardVersions', { kind: 'network' })
    setup({ fake })
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось загрузить версии: Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await rows()).toHaveLength(3)
    expect(fake.callsOf('cardVersions')).toHaveLength(2)
  })
})
