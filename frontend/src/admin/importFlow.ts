import { type ApiResult, describeError } from './api/admin'
import type { Draft, DraftImport } from './draft/draft'
import sampleRows from './fixtures/travel-words.json'
import { type ImportAnalysis, type ImportContext, type ImportDuplicate, type ImportRowError } from './importFile'
import { type CardData, type CardField, type ChangesetError, type ValidationReport, cardKey, pickCard } from './types'
import { FIELD_CODES, type FieldCode, MAX_FILE_NAME } from './validate/rules'
import { issueMessage, trimCard } from './validate/validate'


export const SAMPLE_FILE_NAME = 'travel-words.json'
export const SAMPLE_TEXT = JSON.stringify(sampleRows, null, 2)

export const LIST_LIMIT = 100


export function parseDeckKeys(exportText: string): Set<string> | null {
  let data: unknown
  try {
    data = JSON.parse(exportText)
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null
  const keys = new Set<string>()
  for (const row of data) {
    if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
      keys.add(cardKey(pickCard(row as Partial<Record<CardField, unknown>>)))
    }
  }
  return keys
}

export interface ImportScope {
  context: ImportContext
  freed: ReadonlySet<string>
}

const keyOf = (card: CardData) => cardKey(trimCard(card))

export function buildImportScope(deckKeys: ReadonlySet<string>, draft: Draft): ImportScope {
  const freed = new Set<string>()
  const draftKeys = new Set<string>()

  for (const item of Object.values(draft.items)) {
    switch (item.kind) {
      case 'create':
        draftKeys.add(keyOf(item.card))
        break
      case 'update':
        draftKeys.add(keyOf(item.card))
        if (keyOf(item.base) !== keyOf(item.card)) freed.add(keyOf(item.base))
        break
      case 'archive':
        freed.add(keyOf(item.base))
        break
      case 'restore':
        draftKeys.add(keyOf(item.card ?? item.base))
        break
    }
  }
  for (const file of draft.imports) for (const card of file.cards) draftKeys.add(keyOf(card))

  const held = new Set<string>()
  for (const key of deckKeys) if (!freed.has(key)) held.add(key)
  return { context: { deckKeys: held, draftKeys }, freed }
}


export type AnalysisOk = Extract<ImportAnalysis, { ok: true }>

export interface Review extends AnalysisOk {
  checked: 'server' | 'local' | 'rejected' | 'none'
  serverFound: number
  rejection: string | null
}

export function cardIndices(analysis: AnalysisOk): number[] {
  const skipped = new Set<number>([...analysis.duplicates, ...analysis.errors].map((row) => row.index))
  const out: number[] = []
  for (let i = 0; i < analysis.total; i++) if (!skipped.has(i)) out.push(i)
  return out
}

const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index

export function validateBody(analysis: AnalysisOk, fileName: string, baseRevision: number) {
  if (analysis.cards.length === 0) return null
  return { baseRevision, imports: [{ fileName: clipFileName(fileName), cards: analysis.cards }] }
}

export function reviewWithoutServer(analysis: AnalysisOk): Review {
  return { ...analysis, checked: analysis.cards.length === 0 ? 'none' : 'local', serverFound: 0, rejection: null }
}

function isFieldCode(code: string): code is FieldCode {
  return (FIELD_CODES as readonly string[]).includes(code)
}

function errorText(error: ChangesetError): string {
  const field = error.field as CardField | undefined
  return field && isFieldCode(error.code) ? `${field}: ${issueMessage(field, error.code)}` : `${error.field ?? 'file'}: ${error.message}`
}

export function applyServerResult(analysis: AnalysisOk, result: ApiResult<ValidationReport>, freed: ReadonlySet<string>): Review {
  const indices = cardIndices(analysis)

  if (result.ok) {
    const entry = result.value.imports[0]
    const skipped = new Set(entry ? entry.skipped.map((row) => row.index) : [])
    const cards: CardData[] = []
    const found: ImportDuplicate[] = []
    analysis.cards.forEach((card, i) => {
      if (skipped.has(i) && !freed.has(keyOf(card))) found.push({ index: indices[i], word: card.word, reason: 'deck' })
      else cards.push(card)
    })
    return {
      ...analysis,
      cards,
      duplicates: [...analysis.duplicates, ...found].sort(byIndex),
      checked: 'server',
      serverFound: found.length,
      rejection: null,
    }
  }

  const error = result.error
  if (error.kind === 'validation') {
    const rowErrors = error.errors.filter((e) => e.section === 'imports' && e.field !== undefined && e.index >= 0 && e.index < analysis.cards.length)
    if (rowErrors.length > 0 && rowErrors.length === error.errors.length) {
      const bad = new Map<number, string[]>()
      for (const e of rowErrors) bad.set(e.index, [...(bad.get(e.index) ?? []), errorText(e)])
      const cards: CardData[] = []
      const found: ImportRowError[] = []
      analysis.cards.forEach((card, i) => {
        const messages = bad.get(i)
        if (messages) found.push({ index: indices[i], word: card.word, messages })
        else cards.push(card)
      })
      return {
        ...analysis,
        cards,
        errors: [...analysis.errors, ...found].sort(byIndex),
        checked: 'server',
        serverFound: 0,
        rejection: null,
      }
    }
    return { ...analysis, checked: 'rejected', serverFound: 0, rejection: describeError(error) }
  }
  return reviewWithoutServer(analysis)
}


export function clipFileName(name: string): string {
  const chars = Array.from(name.trim())
  return (chars.length > 0 ? chars : Array.from('import.json')).slice(0, MAX_FILE_NAME).join('')
}

export function toDraftImport(review: Review, fileName: string): DraftImport {
  return {
    fileName: clipFileName(fileName),
    cards: review.cards,
    preview: { added: review.cards.length, skipped: review.duplicates.length, errors: review.errors.length },
  }
}

export function errorReportName(fileName: string): string {
  return `${fileName.replace(/\.json$/i, '') || 'import'}-errors.json`
}

export function buildErrorReport(fileName: string, review: Review): string {
  const report = {
    fileName,
    rows: review.total,
    willBeAdded: review.cards.length,
    checked: review.checked === 'server' ? 'server' : 'local',
    errors: review.errors.map((e) => ({ index: e.index, row: e.index + 1, word: e.word, reasons: e.messages })),
    skipped: review.duplicates.map((d) => ({ index: d.index, row: d.index + 1, word: d.word, reason: d.reason })),
  }
  return `${JSON.stringify(report, null, 2)}\n`
}


export function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}
