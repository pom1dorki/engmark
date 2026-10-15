import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(cleanup)

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть
      </button>
      {open && (
        <Modal
          title="Окно"
          onClose={() => {
            onClose?.()
            setOpen(false)
          }}
          footer={
            <>
              <button type="button">Отмена</button>
              <button type="button">Готово</button>
            </>
          }
        >
          <input aria-label="Поле" />
        </Modal>
      )}
    </>
  )
}

function opened(onClose?: () => void) {
  render(<Harness onClose={onClose} />)
  const opener = screen.getByRole('button', { name: 'Открыть' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, dialog: screen.getByRole('dialog', { name: 'Окно' }) }
}

describe('Modal', () => {
  it('is a modal dialog named by its title, and takes the focus', () => {
    const { dialog } = opened()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog)
  })

  it('closes on Esc, on the cross and on a press on the dimmed background', () => {
    const onClose = vi.fn<() => void>()
    for (const close of [
      (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' }),
      () => fireEvent.click(screen.getByRole('button', { name: 'Закрыть' })),
      (dialog: HTMLElement) => fireEvent.mouseDown(dialog.parentElement as HTMLElement),
    ]) {
      const { dialog } = opened(onClose)
      close(dialog)
      expect(screen.queryByRole('dialog')).toBeNull()
      cleanup()
    }
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('stays open when the press starts inside the window', () => {
    const onClose = vi.fn<() => void>()
    const { dialog } = opened(onClose)
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Поле' }))
    fireEvent.mouseDown(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('gives the focus back to the button that opened it', () => {
    const { opener } = opened()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside: last → first, Shift+Tab from the first or from the window → last', () => {
    const { dialog } = opened()
    const close = screen.getByRole('button', { name: 'Закрыть' })
    const done = screen.getByRole('button', { name: 'Готово' })

    done.focus()
    expect(fireEvent.keyDown(done, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(close)

    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(done)

    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(done)
  })

  it('lets Tab move normally in the middle of the window', () => {
    opened()
    const field = screen.getByRole('textbox', { name: 'Поле' })
    field.focus()
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true)
  })

  it('finds the first and the last control by their place in the page, whatever order the selector engine returns a selector list in', () => {
    const original = Element.prototype.querySelectorAll
    Element.prototype.querySelectorAll = function (this: Element, selector: string) {
      const found = new Set<Element>()
      for (const part of selector.split(/\s*,\s*/)) for (const element of original.call(this, part)) found.add(element)
      return [...found] as unknown as NodeListOf<Element>
    } as typeof original
    try {
      const { dialog } = opened()
      const close = screen.getByRole('button', { name: 'Закрыть' })
      const done = screen.getByRole('button', { name: 'Готово' })
      const field = screen.getByRole('textbox', { name: 'Поле' })

      done.focus()
      expect(fireEvent.keyDown(done, { key: 'Tab' })).toBe(false)
      expect(document.activeElement).toBe(close)

      field.focus()
      expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true)

      dialog.focus()
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(done)
    } finally {
      Element.prototype.querySelectorAll = original
    }
  })
})
