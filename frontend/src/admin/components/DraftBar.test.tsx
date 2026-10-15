import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Draft, emptyDraft } from '../draft/draft'
import { makeCard } from '../testkit'
import { DraftBar } from './DraftBar'

afterEach(cleanup)

function draftWith(): Draft {
  const base = makeCard({ word: 'old' })
  const draft = emptyDraft(1, 42)
  draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'one' }) }
  draft.items['tmp-2'] = { kind: 'create', card: makeCard({ word: 'two' }) }
  draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'другой' } }
  draft.items['102'] = { kind: 'archive', baseVersion: 2, base }
  return draft
}

describe('DraftBar', () => {
  it('shows only non-zero counts and the revisions', () => {
    render(<DraftBar draft={draftWith()} onDiscardAll={vi.fn()} />)
    const region = screen.getByRole('region', { name: 'Черновик' })
    expect(region.textContent).toContain('2 новых · 1 изменено · 1 в архив')
    expect(region.textContent).not.toContain('из архива')
    expect(region.textContent).not.toContain('из файла')
    expect(screen.getByText('основан на ревизии r42 · сохранится как r43')).toBeTruthy()
  })

  it('says the base is out of date when the server is ahead, and not when it is level', () => {
    const { rerender } = render(<DraftBar draft={draftWith()} serverRevision={42} onDiscardAll={vi.fn()} />)
    expect(screen.getByText('основан на ревизии r42 · сохранится как r43')).toBeTruthy()
    rerender(<DraftBar draft={draftWith()} serverRevision={45} onDiscardAll={vi.fn()} />)
    expect(screen.getByText('основан на ревизии r42, на сервере уже r45 · нужно обновить основу')).toBeTruthy()
    expect(screen.queryByText(/сохранится как/)).toBeNull()
  })

  it('shows the draft message', () => {
    const draft = { ...draftWith(), message: 'Откат к r40' }
    render(<DraftBar draft={draft} onDiscardAll={vi.fn()} />)
    expect(screen.getByText('«Откат к r40» · основан на ревизии r42 · сохранится как r43')).toBeTruthy()
  })

  it('keeps review and save disabled until they are wired up', () => {
    render(<DraftBar draft={draftWith()} onDiscardAll={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Просмотреть' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Сохранить изменения' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls review and save when they are given', () => {
    const onReview = vi.fn()
    const onSave = vi.fn()
    render(<DraftBar draft={draftWith()} onReview={onReview} onSave={onSave} onDiscardAll={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Просмотреть' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    expect(onReview).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('needs a second press to discard everything', () => {
    const onDiscardAll = vi.fn()
    render(<DraftBar draft={draftWith()} onDiscardAll={onDiscardAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить всё' }))
    expect(onDiscardAll).not.toHaveBeenCalled()
    expect(screen.getByText('Нажмите ещё раз, чтобы отменить все изменения (4)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Да, отменить всё' }))
    expect(onDiscardAll).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Нажмите ещё раз/)).toBeNull()
  })

  it('drops the confirmation on Escape and when focus leaves the button', () => {
    const onDiscardAll = vi.fn()
    render(<DraftBar draft={draftWith()} onDiscardAll={onDiscardAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить всё' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Да, отменить всё' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Отменить всё' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Отменить всё' }))
    fireEvent.blur(screen.getByRole('button', { name: 'Да, отменить всё' }))
    expect(screen.getByRole('button', { name: 'Отменить всё' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить всё' }))
    expect(onDiscardAll).not.toHaveBeenCalled()
  })
})
