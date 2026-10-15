import { type CardData, sameCard } from '../types'

export const DRAFT_SCHEMA = 1

export type DraftItem =
  | { kind: 'create'; card: CardData }
  | { kind: 'update'; baseVersion: number; base: CardData; card: CardData }
  | { kind: 'archive'; baseVersion: number; base: CardData }
  | { kind: 'restore'; baseVersion: number; base: CardData; card?: CardData }

export interface DraftImport {
  fileName: string
  cards: CardData[]
  preview: { added: number; skipped: number; errors: number }
}

export interface Draft {
  schema: typeof DRAFT_SCHEMA
  deckId: number
  baseRevision: number
  items: Record<string, DraftItem>
  imports: DraftImport[]
  message?: string
}

export type DraftAction =
  | { type: 'upsertCreate'; key: string; card: CardData }
  | { type: 'upsertUpdate'; id: number; baseVersion: number; base: CardData; card: CardData }
  | { type: 'archive'; id: number; baseVersion: number; base: CardData }
  | { type: 'restore'; id: number; baseVersion: number; base: CardData }
  | { type: 'discardItem'; key: string }
  | { type: 'addImport'; file: DraftImport }
  | { type: 'removeImport'; index: number }
  | { type: 'setMessage'; message: string | undefined }
  | { type: 'discardAll' }
  | { type: 'rebase'; baseRevision: number; items: Record<string, DraftItem> }
  | { type: 'replace'; draft: Draft }

export function emptyDraft(deckId: number, baseRevision: number): Draft {
  return { schema: DRAFT_SCHEMA, deckId, baseRevision, items: {}, imports: [] }
}

export function isDraftEmpty(draft: Draft): boolean {
  return Object.keys(draft.items).length === 0 && draft.imports.length === 0
}

export function importedCount(draft: Draft): number {
  return draft.imports.reduce((n, file) => n + file.cards.length, 0)
}

export interface DraftCounts {
  created: number
  updated: number
  archived: number
  restored: number
  imported: number
}

export function draftCounts(draft: Draft): DraftCounts {
  const counts: DraftCounts = { created: 0, updated: 0, archived: 0, restored: 0, imported: importedCount(draft) }
  for (const item of Object.values(draft.items)) {
    if (item.kind === 'create') counts.created++
    else if (item.kind === 'update') counts.updated++
    else if (item.kind === 'archive') counts.archived++
    else counts.restored++
  }
  return counts
}

export function nextCreateKey(draft: Draft): string {
  let max = 0
  for (const key of Object.keys(draft.items)) {
    const match = /^tmp-(\d+)$/.exec(key)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `tmp-${max + 1}`
}

export function isCreateKey(key: string): boolean {
  return key.startsWith('tmp-')
}

function setItem(draft: Draft, key: string, item: DraftItem): Draft {
  return { ...draft, items: { ...draft.items, [key]: item } }
}

function dropIdleMessage(draft: Draft): Draft {
  if (draft.message === undefined || !isDraftEmpty(draft)) return draft
  const next = { ...draft }
  delete next.message
  return next
}

function removeItem(draft: Draft, key: string): Draft {
  if (!(key in draft.items)) return draft
  const items = { ...draft.items }
  delete items[key]
  return dropIdleMessage({ ...draft, items })
}

export function draftReducer(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'upsertCreate':
      return setItem(state, action.key, { kind: 'create', card: action.card })

    case 'upsertUpdate': {
      const key = String(action.id)
      const existing = state.items[key]
      const kept = existing && existing.kind !== 'create' ? existing : null
      const baseVersion = kept ? kept.baseVersion : action.baseVersion
      const base = kept ? kept.base : action.base

      if (existing?.kind === 'restore') {
        const restored: DraftItem = sameCard(base, action.card)
          ? { kind: 'restore', baseVersion, base }
          : { kind: 'restore', baseVersion, base, card: action.card }
        return setItem(state, key, restored)
      }
      if (sameCard(base, action.card)) return removeItem(state, key)
      return setItem(state, key, { kind: 'update', baseVersion, base, card: action.card })
    }

    case 'archive': {
      const key = String(action.id)
      const existing = state.items[key]
      const kept = existing && existing.kind !== 'create' ? existing : null
      const baseVersion = kept ? kept.baseVersion : action.baseVersion
      const base = kept ? kept.base : action.base
      return setItem(state, key, { kind: 'archive', baseVersion, base })
    }

    case 'restore':
      return setItem(state, String(action.id), { kind: 'restore', baseVersion: action.baseVersion, base: action.base })

    case 'discardItem':
      return removeItem(state, action.key)

    case 'addImport':
      return { ...state, imports: [...state.imports, action.file] }

    case 'removeImport':
      return dropIdleMessage({ ...state, imports: state.imports.filter((_, i) => i !== action.index) })

    case 'setMessage':
      return { ...state, message: action.message }

    case 'discardAll':
      return emptyDraft(state.deckId, state.baseRevision)

    case 'rebase':
      return { ...state, baseRevision: action.baseRevision, items: action.items }

    case 'replace':
      return action.draft
  }
}
