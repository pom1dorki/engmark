import { CARD_FIELDS, type CardData, cardKey, emptyCard } from './types'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from './validate/rules'
import { trimCard, validateCard } from './validate/validate'

export type ImportFailure = 'too_large' | 'invalid_json' | 'not_array' | 'empty' | 'too_many_rows'

export interface ImportRowError {
  index: number
  word: string
  messages: string[]
}

export interface ImportDuplicate {
  index: number
  word: string
  reason: 'deck' | 'draft' | 'file'
}

export type ImportAnalysis =
  | { ok: false; failure: ImportFailure; message: string }
  | {
      ok: true
      total: number
      cards: CardData[]
      duplicates: ImportDuplicate[]
      errors: ImportRowError[]
    }

export interface ImportContext {
  deckKeys: ReadonlySet<string>
  draftKeys: ReadonlySet<string>
}

const FAILURES: Record<ImportFailure, string> = {
  too_large: 'Файл больше 4 МБ',
  invalid_json: 'Файл не прочитан: это не JSON',
  not_array: 'Ожидался массив карточек, как в data/cards.json',
  empty: 'В файле нет карточек',
  too_many_rows: `В файле больше ${MAX_IMPORT_ROWS} карточек`,
}

export function importFailure(failure: ImportFailure): ImportAnalysis {
  return { ok: false, failure, message: FAILURES[failure] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function analyzeImport(text: string, context: ImportContext): ImportAnalysis {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) return importFailure('too_large')

  let data: unknown
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return importFailure('invalid_json')
  }
  if (!Array.isArray(data)) return importFailure('not_array')
  if (data.length === 0) return importFailure('empty')
  if (data.length > MAX_IMPORT_ROWS) return importFailure('too_many_rows')

  const cards: CardData[] = []
  const duplicates: ImportDuplicate[] = []
  const errors: ImportRowError[] = []
  const seen = new Set<string>()

  data.forEach((row: unknown, index: number) => {
    if (!isRecord(row)) {
      errors.push({ index, word: '', messages: ['Строка должна быть объектом'] })
      return
    }

    const card = emptyCard()
    const messages: string[] = []
    for (const field of CARD_FIELDS) {
      const value = row[field]
      if (value === undefined) continue
      if (typeof value !== 'string') messages.push(`Поле «${field}» должно быть строкой`)
      else card[field] = value
    }
    const trimmed = trimCard(card)
    if (row.pos === undefined) trimmed.pos = ''
    for (const issue of validateCard(trimmed)) messages.push(`${issue.field}: ${issue.message}`)
    if (messages.length > 0) {
      errors.push({ index, word: trimmed.word, messages })
      return
    }

    const key = cardKey(trimmed)
    const reason = context.deckKeys.has(key) ? 'deck' : context.draftKeys.has(key) ? 'draft' : seen.has(key) ? 'file' : null
    if (reason) {
      duplicates.push({ index, word: trimmed.word, reason })
      return
    }
    seen.add(key)
    cards.push(trimmed)
  })

  return { ok: true, total: data.length, cards, duplicates, errors }
}
