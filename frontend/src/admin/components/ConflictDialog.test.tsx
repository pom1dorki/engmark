import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDraft } from '../draft/draft'
import { type MergeResult, mergeDraft } from '../merge/merge'
import { makeCard, makeChange, makeServerCard } from '../testkit'
import { ConflictDialog } from './ConflictDialog'

afterEach(cleanup)

function fieldsMerge(): MergeResult {
  const base = makeCard({ word: 'ba', translation: 'старый', usage: 'Было.' })
  const draft = emptyDraft(1, 42)
  draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'мой перевод' } }
  const theirs = makeServerCard(101, 2, { word: 'ba', translation: 'серверный перевод', usage: 'Стало.' })
  return mergeDraft({ ...draft }, { revision: 43, since: 42, items: [makeChange(theirs, base)] })
}

function allKinds(): MergeResult {
  const base = makeCard({ word: 'ba', translation: 'старый' })
  const draft = emptyDraft(1, 42)
  draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'мой перевод' } }
  draft.items['102'] = { kind: 'update', baseVersion: 1, base: makeCard({ word: 'ko' }), card: makeCard({ word: 'ko', translation: 'моё' }) }
  draft.items['103'] = { kind: 'archive', baseVersion: 1, base: makeCard({ word: 'mi' }) }
  draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'ra', translation: 'рядом', pos: 'noun' }) }
  const changes = [
    makeChange(makeServerCard(101, 2, { word: 'ba', translation: 'серверный перевод' }), base),
    makeChange(makeServerCard(102, 2, { word: 'ko', archived: true, archivedAt: '2026-10-02T10:00:00Z' }), makeCard({ word: 'ko' })),
    makeChange(makeServerCard(103, 2, { word: 'mi', usage: 'Новое.' }), makeCard({ word: 'mi' })),
    makeChange(makeServerCard(150, 1, { word: 'ra', translation: 'рядом', pos: 'noun' }), null),
  ]
  return mergeDraft(draft, { revision: 43, since: 42, items: changes })
}

function setup(merge: MergeResult, props: { busy?: boolean } = {}) {
  const handlers = { onApply: vi.fn(), onLater: vi.fn() }
  render(<ConflictDialog merge={merge} baseRevision={42} serverRevision={43} busy={props.busy ?? false} {...handlers} />)
  return handlers
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name }) as HTMLInputElement

describe('ConflictDialog', () => {
  it('says that nothing was written and which revisions are involved', () => {
    setup(fieldsMerge())
    expect(screen.getByRole('dialog', { name: 'Колода изменилась, пока вы работали' })).toBeTruthy()
    expect(screen.getByText('Вы начали с ревизии r42, на сервере уже r43. Ничего не записано.')).toBeTruthy()
  })

  it('counts the conflicting and the auto-merged fields', () => {
    setup(fieldsMerge())
    expect(
      screen.getByText('В 1 поле вы и кто-то ещё внесли разные правки. Выберите, что оставить. Ещё 1 поле с сервера подтянется автоматически, вы его не меняли.'),
    ).toBeTruthy()
  })

  it('asks only about the field that really conflicts, with «было» and both variants', () => {
    setup(fieldsMerge())
    const group = screen.getByRole('group', { name: 'Поля карточки «ba», которые изменили и вы, и сервер' })
    expect(within(group).getAllByRole('radiogroup')).toHaveLength(1)
    expect(within(group).getByText('было: старый')).toBeTruthy()
    expect(radio('Ваш вариант: мой перевод').checked).toBe(true)
    expect(radio('На сервере: серверный перевод').checked).toBe(false)
    expect(within(group).getByText('На сервере · v2')).toBeTruthy()
    expect(screen.getByText('Автоматически с сервера: Контекст и стиль')).toBeTruthy()
  })

  it('applies with «mine» for untouched fields and «theirs» after the switch', () => {
    const { onApply } = setup(fieldsMerge())
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r43' }))
    expect(onApply).toHaveBeenLastCalledWith({})

    fireEvent.click(radio('На сервере: серверный перевод'))
    expect(radio('На сервере: серверный перевод').checked).toBe(true)
    expect(radio('Ваш вариант: мой перевод').checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r43' }))
    expect(onApply).toHaveBeenLastCalledWith({ '101:translation': 'theirs' })
  })

  it('shows empty values as «пусто»', () => {
    const base = makeCard({ word: 'ba', usage: '' })
    const draft = emptyDraft(1, 42)
    draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, usage: 'Моё.' } }
    const theirs = makeServerCard(101, 2, { word: 'ba', usage: 'Чужое.' })
    setup(mergeDraft(draft, { revision: 43, since: 42, items: [makeChange(theirs, base)] }))
    expect(screen.getByRole('group', { name: /^Поля карточки «ba»/ }).textContent).toContain('было: пусто')
  })

  it('offers a choice for the cards that conflict as a whole, with the safe defaults', () => {
    const { onApply } = setup(allKinds())
    expect(screen.getByText('Карточку «ko» отправили в архив на сервере, а вы её правили.')).toBeTruthy()
    expect(radio('Вернуть из архива с моими правками').checked).toBe(true)
    expect(screen.getByText('Вы отправили «mi» в архив, а на сервере её изменили.')).toBeTruthy()
    expect(radio('Всё равно отправить в архив').checked).toBe(true)
    expect(screen.getByText(/Ваша новая карточка «ra» совпала по слову, части речи и переводу/)).toBeTruthy()
    expect(radio(/^Оставить мою/).checked).toBe(true)

    fireEvent.click(radio('Отказаться от моих правок'))
    fireEvent.click(radio('Оставить как есть на сервере'))
    fireEvent.click(radio(/^Убрать мою/))
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r43' }))
    expect(onApply).toHaveBeenLastCalledWith({ '102': 'drop', '103': 'drop', 'tmp-1': 'drop' })
  })

  it('counts whole-card conflicts in the summary with the right plural', () => {
    setup(allKinds())
    expect(screen.getByText(/3 карточки требуют отдельного решения/)).toBeTruthy()
  })

  it('says nothing needs choosing when only auto-merged fields are left', () => {
    const base = makeCard({ word: 'ba', translation: 'старый', usage: 'Было.' })
    const draft = emptyDraft(1, 42)
    draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'мой перевод' } }
    const theirs = makeServerCard(101, 2, { word: 'ba', translation: 'старый', usage: 'Стало.' })
    setup(mergeDraft(draft, { revision: 43, since: 42, items: [makeChange(theirs, base)] }))
    expect(screen.getByText(/Ваши правки ни с чем не пересеклись, выбирать ничего не нужно/)).toBeTruthy()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText('Автоматически с сервера: Контекст и стиль')).toBeTruthy()
  })

  it('«Позже» and Esc leave without applying', () => {
    const { onApply, onLater } = setup(fieldsMerge())
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onLater).toHaveBeenCalledTimes(2)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('blocks both buttons and Esc while the repeated save is running', () => {
    const { onApply, onLater } = setup(fieldsMerge(), { busy: true })
    const apply = screen.getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Позже' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(apply)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onApply).not.toHaveBeenCalled()
    expect(onLater).not.toHaveBeenCalled()
  })

  it('keeps the choices of one card apart from another with the same field', () => {
    const base = makeCard({ word: 'ba', translation: 'старый' })
    const other = makeCard({ word: 'ko', translation: 'старый' })
    const draft = emptyDraft(1, 42)
    draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'мой ba' } }
    draft.items['102'] = { kind: 'update', baseVersion: 1, base: other, card: { ...other, translation: 'мой ko' } }
    const merge = mergeDraft(draft, {
      revision: 43,
      since: 42,
      items: [makeChange(makeServerCard(101, 2, { word: 'ba', translation: 'их ba' }), base), makeChange(makeServerCard(102, 2, { word: 'ko', translation: 'их ko' }), other)],
    })
    const { onApply } = setup(merge)
    fireEvent.click(radio('На сервере: их ko'))
    expect(radio('Ваш вариант: мой ba').checked).toBe(true)
    expect(radio('На сервере: их ko').checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Применить поверх r43' }))
    expect(onApply).toHaveBeenLastCalledWith({ '102:translation': 'theirs' })
  })
})
