import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Draft, type DraftAction, emptyDraft } from '../draft/draft'
import type { EditorTarget } from '../editorModel'
import { type FakeApi, createFakeApi } from '../fakeApi'
import { makeCard } from '../testkit'
import { CardEditor } from './CardEditor'

afterEach(cleanup)

function setup(options: { target?: EditorTarget; draft?: Draft; archived?: number[]; failCard?: boolean; prepare?: (fake: FakeApi) => void } = {}) {
  const fake = createFakeApi({ latency: 0 })
  options.prepare?.(fake)
  for (const id of options.archived ?? []) fake.archiveCard(id)
  if (options.failCard) fake.failNext('card', { kind: 'network' })
  const draft = options.draft ?? emptyDraft(1, fake.revision())
  const dispatch = vi.fn<(action: DraftAction) => void>()
  const onClose = vi.fn<() => void>()
  const onToast = vi.fn<(text: string) => void>()
  render(<CardEditor api={fake.api} target={options.target ?? { kind: 'card', id: 101 }} draft={draft} dispatch={dispatch} onClose={onClose} onToast={onToast} />)
  return { fake, dispatch, onClose, onToast, draft }
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const field = (name: string) => document.querySelector(`[data-field="${name}"]`) as HTMLElement

function type(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } })
}

describe('CardEditor', () => {
  it('reads the card when opened and fills the form', async () => {
    const { fake } = setup()
    expect(screen.getByRole('status').textContent).toBe('Загрузка карточки…')
    await screen.findByRole('heading', { name: 'ba' })
    expect(input('Слово').value).toBe('ba')
    expect(input('Перевод').value).toBe('перевод 1')
    expect((input('Часть речи') as unknown as HTMLSelectElement).value).toBe('verb')
    expect(fake.callsOf('card').map((args) => args[0])).toEqual([101])
    expect(screen.getByText(/^ID 101 · версия v1/)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input('Слово')))
  })

  it('does not reread the base of a card that is already in the draft', async () => {
    const base = makeCard({ word: 'ba', translation: 'перевод 1', pos: 'verb' })
    const draft = emptyDraft(1, 1)
    draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'моя правка' } }
    const { fake } = setup({ draft })
    expect(input('Перевод').value).toBe('моя правка')
    expect(fake.callsOf('card')).toHaveLength(0)
    expect(screen.getByText(/есть правки в черновике/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Обновить в черновике' })).toBeTruthy()
    expect(within(field('translation')).getByText('изменено')).toBeTruthy()
    expect(within(field('word')).queryByText('изменено')).toBeNull()
  })

  it('highlights changed fields and enables the draft button only for a real change', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    const submit = screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(document.querySelectorAll('.chg')).toHaveLength(0)

    type('Перевод', 'новый перевод')
    expect(within(field('translation')).getByText('изменено')).toBeTruthy()
    expect(field('translation').className).toContain('changed')
    expect(document.querySelectorAll('.chg')).toHaveLength(1)
    expect(submit.disabled).toBe(false)

    type('Перевод', 'перевод 1')
    expect(document.querySelectorAll('.chg')).toHaveLength(0)
    expect(submit.disabled).toBe(true)
  })

  it('shows validation errors in the field and blocks the button', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    type('Слово', 'ba1')
    expect(within(field('word')).getByText('Только латиница, апостроф, дефис и одиночные пробелы')).toBeTruthy()
    expect(input('Слово').getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement).disabled).toBe(true)

    type('Слово', '')
    expect(within(field('word')).getByText('Обязательное поле')).toBeTruthy()

    type('Слово', 'ba')
    expect(input('Слово').getAttribute('aria-invalid')).toBeNull()
  })

  it('checks that the highlighted text is part of the example', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    type('Выделить', 'nowhere')
    expect(within(field('exampleHighlight')).getByText('Не найдено в предложении')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('puts the edit into the draft with the version it started from', async () => {
    const { dispatch, onClose, onToast } = setup()
    await screen.findByRole('heading', { name: 'ba' })
    type('Перевод', '  новый перевод  ')
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'upsertUpdate',
      id: 101,
      baseVersion: 1,
      base: { translation: 'перевод 1' },
      card: { translation: 'новый перевод' },
    })
    expect(onToast).toHaveBeenCalledWith('Правки «ba» в черновике · основа v1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('applies with Ctrl+Enter from a text area and Cmd+Enter from an input', async () => {
    const { dispatch } = setup()
    await screen.findByRole('heading', { name: 'ba' })
    type('Грамматика', 'Другая грамматика.')
    fireEvent.keyDown(input('Грамматика'), { key: 'Enter', ctrlKey: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input('Перевод'), { key: 'Enter', metaKey: true })
    expect(dispatch).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(input('Перевод'), { key: 'Enter' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('does not apply an unchanged or invalid card with the keyboard', async () => {
    const { dispatch } = setup()
    await screen.findByRole('heading', { name: 'ba' })
    fireEvent.keyDown(input('Перевод'), { key: 'Enter', ctrlKey: true })
    type('Слово', '1')
    fireEvent.keyDown(input('Перевод'), { key: 'Enter', ctrlKey: true })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closes with Escape, the close button and Cancel', async () => {
    const { onClose } = setup()
    await screen.findByRole('heading', { name: 'ba' })
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Редактор карточки' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть редактор' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('sends a card to the archive from its base version', async () => {
    const { dispatch, onClose, onToast } = setup()
    await screen.findByRole('heading', { name: 'ba' })
    fireEvent.click(screen.getByRole('button', { name: 'В архив' }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'archive', id: 101, baseVersion: 1 })
    expect(onToast).toHaveBeenCalledWith('«ba» уйдёт в архив при сохранении')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('detects a duplicate in the deck by word, part of speech and translation', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    type('Слово', 'ko')
    fireEvent.change(input('Часть речи'), { target: { value: 'noun' } })
    type('Перевод', 'перевод 2')
    await waitFor(() => expect(within(field('word')).getByText('Такая карточка уже есть в колоде (слово + часть речи + перевод)')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement).disabled).toBe(true)

    type('Перевод', 'перевод 22')
    await waitFor(() => expect(within(field('word')).queryByText(/Такая карточка уже есть/)).toBeNull())
    expect((screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('detects a duplicate of a new card that is already in the draft', async () => {
    const draft = emptyDraft(1, 1)
    draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'newword', translation: 'новое', pos: 'noun' }) }
    setup({ target: { kind: 'new' }, draft })
    expect(screen.getByRole('heading', { name: 'Новое слово' })).toBeTruthy()
    type('Слово', 'NewWord')
    type('Перевод', 'новое')
    expect(within(field('word')).getByText('Такая карточка уже есть в черновике (слово + часть речи + перевод)')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('creates a new card under the next temporary key', async () => {
    const draft = emptyDraft(1, 1)
    draft.items['tmp-1'] = { kind: 'create', card: makeCard({ word: 'other', translation: 'другое', pos: 'noun' }) }
    const { dispatch, onToast, onClose } = setup({ target: { kind: 'new' }, draft })
    expect(screen.getByText('Ещё не сохранено')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'В архив' })).toBeNull()
    const submit = screen.getByRole('button', { name: 'В черновик' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    type('Слово', 'fresh')
    type('Перевод', 'свежий')
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'upsertCreate', key: 'tmp-2', card: { word: 'fresh' } })
    expect(onToast).toHaveBeenCalledWith('«fresh» добавлено в черновик')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an archived card read-only with a restore button', async () => {
    const { dispatch, onClose } = setup({ archived: [101] })
    await screen.findByRole('heading', { name: 'ba' })
    expect(screen.getByText(/в архиве/, { selector: '.meta' })).toBeTruthy()
    expect(input('Слово').readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: 'В черновик' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'В архив' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть из архива' }))
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'restore', id: 101, baseVersion: 2 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets you cancel archiving that is waiting in the draft', () => {
    const base = makeCard({ word: 'ba', translation: 'перевод 1', pos: 'verb' })
    const draft = emptyDraft(1, 1)
    draft.items['101'] = { kind: 'archive', baseVersion: 1, base }
    const { dispatch, fake } = setup({ draft })
    expect(fake.callsOf('card')).toHaveLength(0)
    expect(input('Слово').readOnly).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить архивирование' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'discardItem', key: '101' })
  })

  it('removes a card from the draft with its own button', () => {
    const base = makeCard({ word: 'ba', translation: 'перевод 1', pos: 'verb' })
    const draft = emptyDraft(1, 1)
    draft.items['101'] = { kind: 'update', baseVersion: 1, base, card: { ...base, translation: 'моя правка' } }
    const { dispatch, onToast, onClose } = setup({ draft })
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из черновика' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'discardItem', key: '101' })
    expect(onToast).toHaveBeenCalledWith('Правки «ba» убраны из черновика')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a read error and reads the card again on retry', async () => {
    const { fake } = setup({ failCard: true })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Не удалось открыть карточку: Нет связи с сервером.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'ba' })
    expect(fake.callsOf('card')).toHaveLength(2)
  })

  it('shows a live preview of the card', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    const preview = screen.getByRole('region', { name: 'Предпросмотр карточки' })
    expect(within(preview).getByText('перевод 1')).toBeTruthy()
    type('Перевод', 'новый перевод')
    expect(within(preview).getByText('новый перевод')).toBeTruthy()
    expect(within(preview).queryByText('перевод 1')).toBeNull()
  })
})

describe('CardEditor: the «Версии» tab', () => {
  const twoEdits = (fake: FakeApi) => {
    fake.editCard(101, { translation: 'второй перевод' })
    fake.editCard(101, { translation: 'третий перевод' })
  }
  const tab = (name: string) => screen.getByRole('tab', { name })

  it('has tabs only for a card that exists on the server', async () => {
    setup()
    await screen.findByRole('heading', { name: 'ba' })
    expect(tab('Карточка').getAttribute('aria-selected')).toBe('true')
    expect(tab('Версии').getAttribute('aria-selected')).toBe('false')
    cleanup()
    setup({ target: { kind: 'new' } })
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('keeps unsaved typing in the form while the versions are looked at, and moves between tabs with arrows', async () => {
    setup({ prepare: twoEdits })
    await screen.findByRole('heading', { name: 'ba' })
    type('Перевод', 'набираю')
    fireEvent.click(tab('Версии'))
    await screen.findByRole('list', { name: 'Версии карточки, новые сверху' })
    expect(screen.getByRole('tabpanel', { name: 'Версии' })).toBeTruthy()

    fireEvent.keyDown(tab('Версии'), { key: 'ArrowLeft' })
    expect(tab('Карточка').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Карточка'))
    expect(input('Перевод').value).toBe('набираю')
    fireEvent.keyDown(tab('Карточка'), { key: 'End' })
    expect(tab('Версии').getAttribute('aria-selected')).toBe('true')
  })

  it('puts the values of an old version into the form: changed fields light up and the edit can go to the draft', async () => {
    const { onToast, dispatch } = setup({ prepare: twoEdits })
    await screen.findByRole('heading', { name: 'ba' })
    fireEvent.click(tab('Версии'))
    await screen.findByRole('list', { name: 'Версии карточки, новые сверху' })
    fireEvent.click(screen.getByRole('button', { name: /^v1 / }))
    fireEvent.click(screen.getByRole('button', { name: 'Взять значения из v1' }))

    expect(tab('Карточка').getAttribute('aria-selected')).toBe('true')
    expect(input('Перевод').value).toBe('перевод 1')
    expect(field('translation').className).toContain('changed')
    expect(onToast).toHaveBeenCalledWith('Значения из v1 подставлены в форму. Проверьте их и добавьте правку в черновик.')

    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'upsertUpdate', id: 101, baseVersion: 3, card: { translation: 'перевод 1' } })
  })

  it('opens straight on the version a link from the history points to', async () => {
    setup({ prepare: twoEdits, target: { kind: 'card', id: 101, version: 2 } })
    expect(tab('Версии').getAttribute('aria-selected')).toBe('true')
    await screen.findByRole('list', { name: 'Версии карточки, новые сверху' })
    expect(screen.getByRole('button', { name: /^v2 / }).getAttribute('aria-expanded')).toBe('true')
  })

  it('does not let an archived card take old values', async () => {
    setup({ prepare: twoEdits, archived: [101] })
    await screen.findByRole('heading', { name: 'ba' })
    fireEvent.click(tab('Версии'))
    await screen.findByRole('list', { name: 'Версии карточки, новые сверху' })
    fireEvent.click(screen.getByRole('button', { name: /^v1 / }))
    expect((screen.getByRole('button', { name: 'Взять значения из v1' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Карточка в архиве: верните её из архива, чтобы править.')).toBeTruthy()
  })
})
