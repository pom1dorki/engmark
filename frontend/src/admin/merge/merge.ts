import type { Draft, DraftItem } from '../draft/draft'
import { CARD_FIELDS, type CardData, type CardField, type Changes, cardKey, pickCard, sameCard } from '../types'

export interface FieldMerge {
  field: CardField
  base: string
  mine: string
  theirs: string
}

export interface AutoMerged {
  key: string
  id: number
  word: string
  serverVersion: number
  fields: CardField[]
}

export type Conflict =
  | { kind: 'fields'; key: string; id: number; word: string; baseVersion: number; serverVersion: number; fields: FieldMerge[] }
  | { kind: 'archived_on_server'; key: string; id: number; word: string; serverVersion: number }
  | { kind: 'changed_on_server'; key: string; id: number; word: string; serverVersion: number }
  | { kind: 'duplicate_create'; key: string; word: string; serverId: number }

export interface MergeResult {
  autoMerged: AutoMerged[]
  conflicts: Conflict[]
  rebasedDraft: Draft
}

interface FieldsMerge {
  merged: CardData
  auto: CardField[]
  conflicts: FieldMerge[]
}

export function mergeFields(base: CardData, mine: CardData, theirs: CardData): FieldsMerge {
  const merged = { ...mine }
  const auto: CardField[] = []
  const conflicts: FieldMerge[] = []
  for (const field of CARD_FIELDS) {
    const b = base[field]
    const m = mine[field]
    const t = theirs[field]
    if (t === b) continue
    if (m === b) {
      merged[field] = t
      auto.push(field)
    } else if (m !== t) {
      conflicts.push({ field, base: b, mine: m, theirs: t })
    }
  }
  return { merged, auto, conflicts }
}

export function choiceKey(itemKey: string, field?: CardField): string {
  return field ? `${itemKey}:${field}` : itemKey
}

export function mergeDraft(draft: Draft, changes: Changes): MergeResult {
  const changed = new Map(changes.items.map((change) => [String(change.current.id), change.current]))

  const serverKeys = new Map<string, number>()
  for (const { current } of changes.items) {
    if (!current.archived) serverKeys.set(cardKey(pickCard(current)), current.id)
  }

  const items: Record<string, DraftItem> = {}
  const autoMerged: AutoMerged[] = []
  const conflicts: Conflict[] = []

  const mergeUpdate = (key: string, id: number, baseVersion: number, base: CardData, mine: CardData, serverVersion: number, theirs: CardData) => {
    const { merged, auto, conflicts: fields } = mergeFields(base, mine, theirs)
    if (auto.length > 0) autoMerged.push({ key, id, word: theirs.word, serverVersion, fields: auto })
    if (fields.length > 0) {
      conflicts.push({ kind: 'fields', key, id, word: theirs.word, baseVersion, serverVersion, fields })
    }
    if (!sameCard(merged, theirs)) items[key] = { kind: 'update', baseVersion: serverVersion, base: theirs, card: merged }
  }

  for (const [key, item] of Object.entries(draft.items)) {
    if (item.kind === 'create') {
      items[key] = item
      const serverId = serverKeys.get(cardKey(item.card))
      if (serverId !== undefined) conflicts.push({ kind: 'duplicate_create', key, word: item.card.word, serverId })
      continue
    }

    const current = changed.get(key)
    if (!current || current.version === item.baseVersion) {
      items[key] = item
      continue
    }
    const id = current.id
    const theirs = pickCard(current)

    switch (item.kind) {
      case 'update':
        if (current.archived) {
          conflicts.push({ kind: 'archived_on_server', key, id, word: theirs.word, serverVersion: current.version })
          items[key] = { kind: 'update', baseVersion: current.version, base: theirs, card: item.card }
        } else {
          mergeUpdate(key, id, item.baseVersion, item.base, item.card, current.version, theirs)
        }
        break

      case 'archive':
        if (current.archived) break
        conflicts.push({ kind: 'changed_on_server', key, id, word: theirs.word, serverVersion: current.version })
        items[key] = { kind: 'archive', baseVersion: current.version, base: theirs }
        break

      case 'restore':
        if (current.archived) {
          items[key] = { ...item, baseVersion: current.version, base: theirs }
        } else if (item.card) {
          mergeUpdate(key, id, item.baseVersion, item.base, item.card, current.version, theirs)
        }
        break
    }
  }

  return {
    autoMerged,
    conflicts,
    rebasedDraft: { ...draft, baseRevision: changes.revision, items },
  }
}

export function applyChoices(rebased: Draft, conflicts: Conflict[], choices: Record<string, string>): Draft {
  const items = { ...rebased.items }

  for (const conflict of conflicts) {
    const item = items[conflict.key]
    if (!item) continue

    switch (conflict.kind) {
      case 'fields': {
        if (item.kind !== 'update') break
        const card = { ...item.card }
        for (const f of conflict.fields) {
          if (choices[choiceKey(conflict.key, f.field)] === 'theirs') card[f.field] = f.theirs
        }
        if (sameCard(card, item.base)) delete items[conflict.key]
        else items[conflict.key] = { ...item, card }
        break
      }
      case 'archived_on_server':
        if (choices[choiceKey(conflict.key)] === 'drop') delete items[conflict.key]
        else if (item.kind === 'update') {
          items[conflict.key] = sameCard(item.card, item.base)
            ? { kind: 'restore', baseVersion: item.baseVersion, base: item.base }
            : { kind: 'restore', baseVersion: item.baseVersion, base: item.base, card: item.card }
        }
        break
      case 'changed_on_server':
      case 'duplicate_create':
        if (choices[choiceKey(conflict.key)] === 'drop') delete items[conflict.key]
        break
    }
  }
  return { ...rebased, items }
}
