
export const CARD_FIELDS = [
  'word',
  'translation',
  'ipa',
  'pronunciation',
  'stressNote',
  'pos',
  'grammar',
  'usage',
  'example',
  'exampleHighlight',
  'exampleTranslation',
] as const

export type CardField = (typeof CARD_FIELDS)[number]

export type CardData = Record<CardField, string>

export const POS_VALUES = ['verb', 'noun', 'adj', 'adv'] as const
export type Pos = (typeof POS_VALUES)[number]

export function emptyCard(): CardData {
  return {
    word: '',
    translation: '',
    ipa: '',
    pronunciation: '',
    stressNote: '',
    pos: 'noun',
    grammar: '',
    usage: '',
    example: '',
    exampleHighlight: '',
    exampleTranslation: '',
  }
}

export function pickCard(source: Partial<Record<CardField, unknown>>): CardData {
  const out = emptyCard()
  for (const field of CARD_FIELDS) {
    const value = source[field]
    out[field] = typeof value === 'string' ? value : ''
  }
  return out
}

export function sameCard(a: CardData, b: CardData): boolean {
  return CARD_FIELDS.every((field) => a[field] === b[field])
}

export function cardKey(card: CardData): string {
  return `${card.word.toLowerCase()}|${card.pos}|${card.translation}`
}


export interface ServerCard extends CardData {
  id: number
  version: number
  archived: boolean
  archivedAt: string | null
  createdRevision: number
  updatedRevision: number
  updatedAt: string
}

export interface DeckInfo {
  id: number
  slug: string
  title: string
  revision: number
  activeCards: number
  archivedCards: number
}

export interface CardList {
  revision: number
  items: ServerCard[]
  total: number
  limit: number
  offset: number
}

export interface CardVersion {
  cardId: number
  version: number
  revision: number
  archived: boolean
  createdAt: string
  card: CardData
}

export interface ServerChange {
  current: ServerCard
  base: CardVersion | null
}

export interface Changes {
  revision: number
  since: number
  items: ServerChange[]
}

export interface ImportedFile {
  name: string
  added: number
  skipped: number
}

export interface RevisionInfo {
  revision: number
  baseRevision: number
  author: string
  message: string
  source: string
  created: number
  updated: number
  archived: number
  restored: number
  importedFiles: ImportedFile[]
  createdAt: string
}

export interface RevisionChange {
  cardId: number
  version: number
  kind: 'created' | 'updated' | 'archived' | 'restored'
  word: string
  translation: string
}

export interface RevisionDetail extends RevisionInfo {
  changes: RevisionChange[]
}

export interface SkippedRow {
  index: number
  reason: string
}

export interface ImportReport {
  fileName: string
  added: number
  skipped: SkippedRow[]
}

export interface ValidationReport {
  revision: number
  imports: ImportReport[]
}

export interface SaveResult {
  revision: number
  created: { tempIndex: number; id: number }[]
  updated: { id: number; version: number }[]
  imports: ImportReport[]
}

export interface ChangesetError {
  section: string
  index: number
  id?: number
  file?: string
  field?: string
  code: string
  message: string
}


export interface ChangesetBody {
  baseRevision: number
  message?: string
  create: CardData[]
  update: { id: number; baseVersion: number; card: CardData }[]
  archive: { id: number; baseVersion: number }[]
  restore: { id: number; baseVersion: number }[]
  imports: { fileName: string; cards: CardData[] }[]
}
