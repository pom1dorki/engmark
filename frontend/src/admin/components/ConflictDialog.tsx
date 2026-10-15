import { useId, useState } from 'react'
import { FIELD_LABELS, POS_FULL } from '../labels'
import { type Conflict, type FieldMerge, choiceKey, type MergeResult } from '../merge/merge'
import { type ConflictGroup, conflictCounts, conflictGroups, conflictSummary } from '../saveFlow'
import type { CardField } from '../types'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface Props {
  merge: MergeResult
  baseRevision: number
  serverRevision: number
  busy: boolean
  onApply: (choices: Record<string, string>) => void
  onLater: () => void
}

type Choices = Record<string, string>

const DEFAULT_CHOICE: Record<Exclude<Conflict['kind'], 'fields'>, string> = {
  archived_on_server: 'restore',
  changed_on_server: 'archive',
  duplicate_create: 'keep',
}

function shown(field: CardField, value: string) {
  if (value === '') return <i>пусто</i>
  return field === 'pos' ? (POS_FULL[value] ?? value) : value
}

function FieldRow({ group, merge, choices, onChoose }: { group: ConflictGroup; merge: Extract<Conflict, { kind: 'fields' }>; choices: Choices; onChoose: (key: string, value: string) => void }) {
  return (
    <div className="cmp" role="group" aria-label={`Поля карточки «${group.word}», которые изменили и вы, и сервер`}>
      <div className="cmp__head" aria-hidden="true">
        <span>Поле</span>
        <span>Ваш вариант</span>
        <span>На сервере · v{merge.serverVersion}</span>
      </div>
      {merge.fields.map((item) => (
        <FieldChoice key={item.field} itemKey={group.key} item={item} choice={choices[choiceKey(group.key, item.field)] ?? 'mine'} onChoose={onChoose} />
      ))}
    </div>
  )
}

function FieldChoice({ itemKey, item, choice, onChoose }: { itemKey: string; item: FieldMerge; choice: string; onChoose: (key: string, value: string) => void }) {
  const labelId = useId()
  const key = choiceKey(itemKey, item.field)
  const option = (value: 'mine' | 'theirs', who: string, text: string) => (
    <label className="opt">
      <input type="radio" name={`${itemKey}-${item.field}`} value={value} checked={choice === value} onChange={() => onChoose(key, value)} />
      <span>
        <span className="opt__who">{who}:</span> {shown(item.field, text)}
      </span>
    </label>
  )
  return (
    <div className="cmp__row" role="radiogroup" aria-labelledby={labelId}>
      <div className="cmp__field" id={labelId}>
        {FIELD_LABELS[item.field]} <small>было: {shown(item.field, item.base)}</small>
      </div>
      {option('mine', 'Ваш вариант', item.mine)}
      {option('theirs', 'На сервере', item.theirs)}
    </div>
  )
}

function CardChoice({ conflict, choice, onChoose }: { conflict: Exclude<Conflict, { kind: 'fields' }>; choice: string; onChoose: (key: string, value: string) => void }) {
  const key = choiceKey(conflict.key)
  const texts: Record<typeof conflict.kind, { legend: string; options: [string, string][] }> = {
    archived_on_server: {
      legend: `Карточку «${conflict.word}» отправили в архив на сервере, а вы её правили.`,
      options: [
        ['restore', 'Вернуть из архива с моими правками'],
        ['drop', 'Отказаться от моих правок'],
      ],
    },
    changed_on_server: {
      legend: `Вы отправили «${conflict.word}» в архив, а на сервере её изменили.`,
      options: [
        ['archive', 'Всё равно отправить в архив'],
        ['drop', 'Оставить как есть на сервере'],
      ],
    },
    duplicate_create: {
      legend: `Ваша новая карточка «${conflict.word}» совпала по слову, части речи и переводу с карточкой, которую добавили на сервере.`,
      options: [
        ['keep', 'Оставить мою: слово или перевод придётся изменить'],
        ['drop', 'Убрать мою: на сервере она уже есть'],
      ],
    },
  }
  const text = texts[conflict.kind]
  return (
    <fieldset className="cchoice">
      <legend>{text.legend}</legend>
      {text.options.map(([value, label]) => (
        <label className="opt" key={value}>
          <input type="radio" name={`card-${conflict.key}`} value={value} checked={choice === value} onChange={() => onChoose(key, value)} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function ConflictDialog({ merge, baseRevision, serverRevision, busy, onApply, onLater }: Props) {
  const [choices, setChoices] = useState<Choices>({})
  const groups = conflictGroups(merge)
  const counts = conflictCounts(merge)
  const choose = (key: string, value: string) => setChoices((prev) => ({ ...prev, [key]: value }))

  return (
    <Modal
      title="Колода изменилась, пока вы работали"
      onClose={busy ? () => undefined : onLater}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onLater} disabled={busy}>
            Позже
          </button>
          <button type="button" className="btn pri" onClick={() => onApply(choices)} disabled={busy}>
            {busy ? 'Сохраняю…' : `Применить поверх r${serverRevision}`}
          </button>
        </>
      }
    >
      <p className="mdesc">
        Вы начали с ревизии r{baseRevision}, на сервере уже r{serverRevision}. Ничего не записано.
      </p>

      <div className="note warn">
        <Icon name="warn" />
        <span>{conflictSummary(counts)}</span>
      </div>

      {groups.map((group) => {
        const conflict = group.conflict
        return (
          <section className="cgrp" key={group.key}>
            <h3>
              <span lang="en">{group.word}</span>
              <span className="cgrp__ver">
                {conflict?.kind === 'fields' ? ` · ваша основа v${conflict.baseVersion}, на сервере v${conflict.serverVersion}` : group.serverVersion > 0 ? ` · на сервере v${group.serverVersion}` : ''}
              </span>
            </h3>
            {conflict?.kind === 'fields' && <FieldRow group={group} merge={conflict} choices={choices} onChoose={choose} />}
            {conflict && conflict.kind !== 'fields' && <CardChoice conflict={conflict} choice={choices[choiceKey(conflict.key)] ?? DEFAULT_CHOICE[conflict.kind]} onChoose={choose} />}
            {group.auto.length > 0 && <p className="cgrp__auto">Автоматически с сервера: {group.auto.map((field) => FIELD_LABELS[field]).join(', ')}</p>}
          </section>
        )
      })}
    </Modal>
  )
}
