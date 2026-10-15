import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftReducer, emptyDraft } from '../draft/draft'
import { makeCard } from '../testkit'
import { RevertDialog } from './RevertDialog'

afterEach(cleanup)

describe('RevertDialog', () => {
  it('says how many unsaved edits the revert will replace and lets the person choose', () => {
    let draft = draftReducer(emptyDraft(1, 42), { type: 'upsertCreate', key: 'tmp-1', card: makeCard({ word: 'fresh' }) })
    draft = draftReducer(draft, { type: 'archive', id: 7, baseVersion: 1, base: makeCard() })
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<RevertDialog revision={40} draft={draft} onConfirm={onConfirm} onCancel={onCancel} />)

    const dialog = screen.getByRole('dialog', { name: 'Откатить к r40?' })
    expect(dialog.textContent).toContain('В черновике 2 несохранённые правки')
    fireEvent.click(screen.getByRole('button', { name: 'Не откатывать' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить черновик и откатить' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('counts the rows of a file and closes on Esc as «Не откатывать»', () => {
    const draft = draftReducer(emptyDraft(1, 42), {
      type: 'addImport',
      file: { fileName: 'a.json', cards: [makeCard({ word: 'a' }), makeCard({ word: 'b' }), makeCard({ word: 'c' }), makeCard({ word: 'd' }), makeCard({ word: 'e' })], preview: { added: 5, skipped: 0, errors: 0 } },
    })
    const onCancel = vi.fn()
    render(<RevertDialog revision={3} draft={draft} onConfirm={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByRole('dialog').textContent).toContain('В черновике 5 несохранённых правок')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
