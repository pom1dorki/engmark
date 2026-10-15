import type { CardsQuery } from './api/admin'
import { type Draft, type DraftImport, type DraftItem, isCreateKey } from './draft/draft'
import { CARD_FIELDS, type CardData, type ServerCard, cardKey, pickCard } from './types'

export type RowState = 'published' | 'archived' | 'new' | 'changed' | 'archiving' | 'restoring'

export interface Row {
  key: string
  id: number | null
  card: CardData
  state: RowState
  version: number | null
  nextVersion: number | null
  filled: number
}

export type StateFilter = 'active' | 'draft' | 'incomplete' | 'archived'

export interface ListFilters {
  q: string
  pos: string
  state: StateFilter
}

export const PAGE_SIZE = 50
export const FIELD_COUNT = CARD_FIELDS.length

export const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'active', label: 'Активные' },
  { value: 'draft', label: 'В черновике' },
  { value: 'incomplete', label: 'Неполные' },
  { value: 'archived', label: 'Архив' },
]

export function filledCount(card: CardData): number {
  return CARD_FIELDS.filter((field) => card[field].trim() !== '').length
}

export function serverQuery(filters: ListFilters): CardsQuery | null {
  if (filters.state === 'draft') return null
  const query: CardsQuery = { state: filters.state === 'archived' ? 'archived' : filters.state === 'incomplete' ? 'incomplete' : 'active' }
  const q = filters.q.trim()
  if (q !== '') query.q = q
  if (filters.pos !== '') query.pos = filters.pos
  return query
}

function makeRow(key: string, item: DraftItem): Row {
  const id = isCreateKey(key) ? null : Number(key)
  switch (item.kind) {
    case 'create':
      return { key, id, card: item.card, state: 'new', version: null, nextVersion: null, filled: filledCount(item.card) }
    case 'update':
      return { key, id, card: item.card, state: 'changed', version: item.baseVersion, nextVersion: item.baseVersion + 1, filled: filledCount(item.card) }
    case 'archive':
      return { key, id, card: item.base, state: 'archiving', version: item.baseVersion, nextVersion: item.baseVersion + 1, filled: filledCount(item.base) }
    case 'restore': {
      const card = item.card ?? item.base
      return { key, id, card, state: 'restoring', version: item.baseVersion, nextVersion: item.baseVersion + 1, filled: filledCount(card) }
    }
  }
}

function serverRow(card: ServerCard, item: DraftItem | undefined): Row {
  if (item) return makeRow(String(card.id), item)
  const data = pickCard(card)
  return {
    key: String(card.id),
    id: card.id,
    card: data,
    state: card.archived ? 'archived' : 'published',
    version: card.version,
    nextVersion: null,
    filled: filledCount(data),
  }
}

export function versionText(row: Row): string {
  if (row.version === null) return '—'
  return row.nextVersion === null ? `v${row.version}` : `v${row.version} → v${row.nextVersion}`
}

function matchesState(row: Row, state: StateFilter): boolean {
  switch (state) {
    case 'active':
      return row.state !== 'archived'
    case 'archived':
      return row.state === 'archived'
    case 'incomplete':
      return row.state !== 'archived' && row.filled < FIELD_COUNT
    case 'draft':
      return row.state !== 'published' && row.state !== 'archived'
  }
}

export function matchesFilters(row: Row, filters: ListFilters): boolean {
  if (!matchesState(row, filters.state)) return false
  if (filters.pos !== '' && row.card.pos !== filters.pos) return false
  const q = filters.q.trim().toLowerCase()
  if (q !== '' && !row.card.word.toLowerCase().includes(q) && !row.card.translation.toLowerCase().includes(q)) return false
  return true
}

function createNumber(key: string): number {
  return Number(key.replace(/^tmp-/, ''))
}

export function buildRows(serverItems: ServerCard[], draft: Draft, filters: ListFilters): Row[] {
  const loaded = filters.state === 'draft' ? [] : serverItems
  const seen = new Set(loaded.map((card) => String(card.id)))

  const extra: Row[] = []
  for (const [key, item] of Object.entries(draft.items)) {
    if (seen.has(key)) continue
    if (filters.state === 'draft') extra.push(makeRow(key, item))
    else if (item.kind === 'create' || item.kind === 'restore') extra.push(makeRow(key, item))
  }
  extra.sort((a, b) => {
    if (a.state === 'new' && b.state === 'new') return createNumber(b.key) - createNumber(a.key)
    if (a.state === 'new') return -1
    if (b.state === 'new') return 1
    return a.card.word.toLowerCase().localeCompare(b.card.word.toLowerCase()) || (a.id ?? 0) - (b.id ?? 0)
  })

  const server = loaded.map((card) => serverRow(card, draft.items[String(card.id)]))
  return [...extra, ...server].filter((row) => matchesFilters(row, filters))
}


export interface ImportGroup {
  index: number
  fileName: string
  count: number
}

export function importGroups(imports: DraftImport[], filters: ListFilters): ImportGroup[] {
  if ((filters.state !== 'active' && filters.state !== 'draft') || filters.q.trim() !== '' || filters.pos !== '') return []
  return imports.flatMap((file, index) => (file.cards.length > 0 ? [{ index, fileName: file.fileName, count: file.cards.length }] : []))
}


export interface DuplicateHit {
  where: 'deck' | 'draft'
  id: number | null
  word: string
}

export function findDuplicate(card: CardData, selfKey: string | null, draft: Draft, serverMatches: ServerCard[]): DuplicateHit | null {
  const target = cardKey(card)

  for (const [key, item] of Object.entries(draft.items)) {
    if (key === selfKey || item.kind === 'archive') continue
    const occupant = item.kind === 'restore' ? (item.card ?? item.base) : item.card
    if (cardKey(occupant) === target) return { where: 'draft', id: isCreateKey(key) ? null : Number(key), word: occupant.word }
  }

  for (const server of serverMatches) {
    const key = String(server.id)
    if (key === selfKey || key in draft.items) continue
    if (server.archived) continue
    if (cardKey(pickCard(server)) === target) return { where: 'deck', id: server.id, word: server.word }
  }
  return null
}
