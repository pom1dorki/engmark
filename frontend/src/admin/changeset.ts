import { type Draft, type DraftItem, DRAFT_SCHEMA, isCreateKey } from './draft/draft'
import type { CardData, ChangesetBody } from './types'
import { trimCard } from './validate/validate'

export interface BuiltChangeset {
  body: ChangesetBody
  createKeys: string[]
  updateKeys: string[]
  archiveKeys: string[]
  restoreKeys: string[]
  importIndexes: number[]
}

function numericOrder(a: string, b: string): number {
  return Number(a.replace(/^tmp-/, '')) - Number(b.replace(/^tmp-/, ''))
}

export function toChangeset(draft: Draft, message?: string): BuiltChangeset {
  const body: ChangesetBody = {
    baseRevision: draft.baseRevision,
    create: [],
    update: [],
    archive: [],
    restore: [],
    imports: [],
  }
  const text = (message ?? draft.message ?? '').trim()
  if (text !== '') body.message = text

  const updateKeys: string[] = []
  const archiveKeys: string[] = []
  const restoreKeys: string[] = []
  const importIndexes: number[] = []

  const createKeys = Object.keys(draft.items).filter(isCreateKey).sort(numericOrder)
  for (const key of createKeys) {
    const item = draft.items[key]
    if (item.kind === 'create') body.create.push(trimCard(item.card))
  }

  const ids = Object.keys(draft.items)
    .filter((key) => !isCreateKey(key))
    .sort((a, b) => Number(a) - Number(b))
  for (const key of ids) {
    const item = draft.items[key]
    const id = Number(key)
    switch (item.kind) {
      case 'update':
        body.update.push({ id, baseVersion: item.baseVersion, card: trimCard(item.card) })
        updateKeys.push(key)
        break
      case 'archive':
        body.archive.push({ id, baseVersion: item.baseVersion })
        archiveKeys.push(key)
        break
      case 'restore':
        body.restore.push({ id, baseVersion: item.baseVersion })
        restoreKeys.push(key)
        if (item.card) {
          body.update.push({ id, baseVersion: item.baseVersion, card: trimCard(item.card) })
          updateKeys.push(key)
        }
        break
      case 'create':
        break
    }
  }

  draft.imports.forEach((file, index) => {
    if (file.cards.length === 0) return
    body.imports.push({ fileName: file.fileName, cards: file.cards.map(trimCard) })
    importIndexes.push(index)
  })
  return { body, createKeys, updateKeys, archiveKeys, restoreKeys, importIndexes }
}

export function draftFromChangeset(cs: ChangesetBody, deckId: number, bases: Record<number, CardData>): Draft {
  const items: Record<string, DraftItem> = {}
  const baseOf = (id: number): CardData => {
    const base = bases[id]
    if (!base) throw new Error(`no base state for card ${id}`)
    return base
  }

  cs.create.forEach((card, i) => {
    items[`tmp-${i + 1}`] = { kind: 'create', card }
  })
  const edits = new Map(cs.update.map((u) => [u.id, u]))
  for (const ref of cs.restore) {
    const edit = edits.get(ref.id)
    items[String(ref.id)] = edit
      ? { kind: 'restore', baseVersion: ref.baseVersion, base: baseOf(ref.id), card: edit.card }
      : { kind: 'restore', baseVersion: ref.baseVersion, base: baseOf(ref.id) }
    edits.delete(ref.id)
  }
  for (const edit of edits.values()) {
    items[String(edit.id)] = { kind: 'update', baseVersion: edit.baseVersion, base: baseOf(edit.id), card: edit.card }
  }
  for (const ref of cs.archive) {
    items[String(ref.id)] = { kind: 'archive', baseVersion: ref.baseVersion, base: baseOf(ref.id) }
  }

  const draft: Draft = { schema: DRAFT_SCHEMA, deckId, baseRevision: cs.baseRevision, items, imports: [] }
  if (cs.message) draft.message = cs.message
  return draft
}
