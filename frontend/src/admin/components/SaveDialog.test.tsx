import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Draft, emptyDraft } from '../draft/draft'
import { makeCard } from '../testkit'
import { SaveDialog } from './SaveDialog'

afterEach(cleanup)

function draftWith(): Draft {
  const base = makeCard({ word: 'old', translation: 'старый' })
  const draft = emptyDraft(1, 42)
  draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'fresh', translation: 'свежий' }) }
  draft.items['101'] = { kind: 'update', baseVersion: 2, base, card: { ...base, translation: 'другой', usage: 'Иначе.' } }
  draft.items['102'] = { kind: 'archive', baseVersion: 1, base: makeCard({ word: 'gone', translation: 'ушёл' }) }
  draft.imports.push({ fileName: 'travel.json', cards: [makeCard({ word: 'one' }), makeCard({ word: 'two' })], preview: { added: 2, skipped: 0, errors: 0 } })
  return draft
}

function setup(props: Partial<Parameters<typeof SaveDialog>[0]> = {}) {
  const handlers = { onMessage: vi.fn(), onSave: vi.fn(), onClose: vi.fn() }
  render(<SaveDialog draft={draftWith()} message="Правки карточек" busy={false} failure={null} resumed={false} problems={{}} {...handlers} {...props} />)
  return handlers
}

const list = () => screen.getByRole('list', { name: 'Что будет записано' })
const comment = () => screen.getByLabelText('Комментарий к ревизии') as HTMLInputElement

describe('SaveDialog', () => {
  it('lists every draft item with its kind, translation and version: new first, then by word, files last', () => {
    setup()
    const items = within(list()).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Новаяfresh' + 'свежий' + 'новая · v1',
      'В архивgone' + 'ушёл' + 'v1 → v2',
      'Измененаold' + 'другой' + 'v2 → v3' + 'Изменено: Перевод, Контекст и стиль',
      'Файлtravel.json' + '2 новых карточек' + 'v1',
    ])
  })

  it('shows the revision line with the counters', () => {
    setup()
    expect(screen.getByText('r42 → r43 · +3 ~1 −1')).toBeTruthy()
  })

  it('gives the comment field the suggested text and reports typing', () => {
    const { onMessage } = setup()
    expect(comment().value).toBe('Правки карточек')
    expect(comment().maxLength).toBe(500)
    fireEvent.change(comment(), { target: { value: 'Добавил слова' } })
    expect(onMessage).toHaveBeenCalledWith('Добавил слова')
  })

  it('saves with the Save button and with Enter in the comment field', () => {
    const { onSave } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    fireEvent.keyDown(comment(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('goes back with the Back button and with Esc', () => {
    const { onClose, onSave } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('while the request is in flight blocks both buttons, Enter, Esc and the second save', () => {
    const { onClose, onSave } = setup({ busy: true })
    const save = screen.getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(save)
    fireEvent.keyDown(comment(), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers «Повторить» after a connection failure and shows the text', () => {
    setup({ failure: { kind: 'failed', text: 'Не удалось сохранить, черновик на месте. Нет связи с сервером.' } })
    expect(screen.getByRole('alert').textContent).toContain('Не удалось сохранить, черновик на месте. Нет связи с сервером.')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  })

  it('shows the lines of a rejection without a retry label', () => {
    setup({ failure: { kind: 'rejected', lines: ['Файл «a.json»: строка 3: слово пустое', 'Комментарий слишком длинный'] } })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Сервер не принял изменения. Ничего не записано, черновик на месте.')
    expect(alert.textContent).toContain('Файл «a.json»: строка 3: слово пустое')
    expect(alert.textContent).toContain('Комментарий слишком длинный')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy()
  })

  it('shows the stale text and keeps the Save label', () => {
    setup({ failure: { kind: 'stale', text: 'Сервер отказал из-за версии карточки, хотя колода не менялась. Черновик не тронут.' } })
    expect(screen.getByRole('alert').textContent).toContain('хотя колода не менялась')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy()
  })

  it('tells the person who signed in again that the draft is intact', () => {
    setup({ resumed: true })
    expect(screen.getByRole('status').textContent).toContain('Вы снова вошли, черновик на месте. Нажмите «Сохранить», чтобы продолжить.')
  })

  it('marks the items the server did not accept and shows why', () => {
    setup({ problems: { 'tmp-1': ['Слово: уже есть в колоде'], 'import:0': ['Строка 2: перевод пустой'] } })
    const items = within(list()).getAllByRole('listitem')
    expect(items[0].className).toBe('citem bad')
    expect(items[0].textContent).toContain('Слово: уже есть в колоде')
    expect(items[1].className).toBe('citem')
    expect(items[2].className).toBe('citem')
    expect(items[3].className).toBe('citem bad')
    expect(items[3].textContent).toContain('Строка 2: перевод пустой')
  })

  it('does not list an import file without cards', () => {
    const draft = draftWith()
    draft.imports.push({ fileName: 'empty.json', cards: [], preview: { added: 0, skipped: 0, errors: 0 } })
    setup({ draft })
    expect(within(list()).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByText('empty.json')).toBeNull()
  })
})
