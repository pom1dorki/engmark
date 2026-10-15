import { CARD_FIELDS, type CardData } from '../types'
import { DRAFT_SCHEMA, type Draft, type DraftImport, type DraftItem } from './draft'

export const DRAFT_KEY = 'em-admin-draft'

export type DraftNotice = 'schema' | 'deck' | 'corrupt'

export interface LoadedDraft {
  draft: Draft | null
  notice: DraftNotice | null
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function card(value: unknown): CardData | null {
  if (!isRecord(value)) return null
  const out = {} as CardData
  for (const field of CARD_FIELDS) {
    const v = value[field]
    if (typeof v !== 'string') return null
    out[field] = v
  }
  return out
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function item(value: unknown): DraftItem | null {
  if (!isRecord(value)) return null
  switch (value.kind) {
    case 'create': {
      const c = card(value.card)
      return c ? { kind: 'create', card: c } : null
    }
    case 'update': {
      const base = card(value.base)
      const c = card(value.card)
      return base && c && positive(value.baseVersion) ? { kind: 'update', baseVersion: value.baseVersion, base, card: c } : null
    }
    case 'archive': {
      const base = card(value.base)
      return base && positive(value.baseVersion) ? { kind: 'archive', baseVersion: value.baseVersion, base } : null
    }
    case 'restore': {
      const base = card(value.base)
      if (!base || !positive(value.baseVersion)) return null
      if (value.card === undefined) return { kind: 'restore', baseVersion: value.baseVersion, base }
      const c = card(value.card)
      return c ? { kind: 'restore', baseVersion: value.baseVersion, base, card: c } : null
    }
    default:
      return null
  }
}

function importFile(value: unknown): DraftImport | null {
  if (!isRecord(value) || typeof value.fileName !== 'string' || !Array.isArray(value.cards) || !isRecord(value.preview)) return null
  const cards: CardData[] = []
  for (const raw of value.cards) {
    const c = card(raw)
    if (!c) return null
    cards.push(c)
  }
  const { added, skipped, errors } = value.preview
  if (typeof added !== 'number' || typeof skipped !== 'number' || typeof errors !== 'number') return null
  return { fileName: value.fileName, cards, preview: { added, skipped, errors } }
}

export function parseDraft(raw: string | null, deckId: number): LoadedDraft {
  if (raw === null) return { draft: null, notice: null }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { draft: null, notice: 'corrupt' }
  }
  if (!isRecord(value)) return { draft: null, notice: 'corrupt' }
  if (value.schema !== DRAFT_SCHEMA) return { draft: null, notice: 'schema' }
  if (value.deckId !== deckId) return { draft: null, notice: 'deck' }
  if (!positive(value.baseRevision) && value.baseRevision !== 0) return { draft: null, notice: 'corrupt' }
  if (!isRecord(value.items) || !Array.isArray(value.imports)) return { draft: null, notice: 'corrupt' }

  const items: Record<string, DraftItem> = {}
  for (const [key, raw] of Object.entries(value.items)) {
    const parsed = item(raw)
    if (!parsed) return { draft: null, notice: 'corrupt' }
    items[key] = parsed
  }
  const imports: DraftImport[] = []
  for (const raw of value.imports) {
    const parsed = importFile(raw)
    if (!parsed) return { draft: null, notice: 'corrupt' }
    imports.push(parsed)
  }
  const draft: Draft = { schema: DRAFT_SCHEMA, deckId, baseRevision: value.baseRevision as number, items, imports }
  if (typeof value.message === 'string') draft.message = value.message
  return { draft, notice: null }
}

export function loadDraft(storage: ReadableStorage, deckId: number): LoadedDraft {
  let raw: string | null
  try {
    raw = storage.getItem(DRAFT_KEY)
  } catch {
    return { draft: null, notice: null }
  }
  return parseDraft(raw, deckId)
}

export function saveDraft(storage: WritableStorage, draft: Draft): boolean {
  try {
    if (Object.keys(draft.items).length === 0 && draft.imports.length === 0) storage.removeItem(DRAFT_KEY)
    else storage.setItem(DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function clearDraft(storage: WritableStorage): boolean {
  try {
    storage.removeItem(DRAFT_KEY)
    return true
  } catch {
    return false
  }
}
