import { describe, expect, it } from 'vitest'
import type { ApiResult } from './api/admin'
import { emptyDraft, type Draft } from './draft/draft'
import { analyzeImport } from './importFile'
import {
  type AnalysisOk,
  SAMPLE_FILE_NAME,
  SAMPLE_TEXT,
  applyServerResult,
  buildErrorReport,
  buildImportScope,
  cardIndices,
  clipFileName,
  errorReportName,
  parseDeckKeys,
  readText,
  reviewWithoutServer,
  toDraftImport,
  validateBody,
} from './importFlow'
import { makeCard } from './testkit'
import { type ChangesetError, type ValidationReport, cardKey } from './types'
import { MAX_FILE_NAME } from './validate/rules'

const where = makeCard({ word: 'where', translation: 'где, куда', pos: 'adv', example: '', exampleHighlight: '', exampleTranslation: '' })
const deckText = JSON.stringify([where, makeCard({ word: 'when' })])

function scopeOf(draft: Draft = emptyDraft(1, 5), text = deckText) {
  const keys = parseDeckKeys(text)
  if (!keys) throw new Error('deck did not parse')
  return buildImportScope(keys, draft)
}

function analyze(text: string, draft: Draft = emptyDraft(1, 5)): { analysis: AnalysisOk; freed: ReadonlySet<string> } {
  const scope = scopeOf(draft)
  const analysis = analyzeImport(text, scope.context)
  if (!analysis.ok) throw new Error(`import failed: ${analysis.failure}`)
  return { analysis, freed: scope.freed }
}

const okReport = (skipped: number[] = []): ApiResult<ValidationReport> => ({
  ok: true,
  etag: null,
  notModified: false,
  value: { revision: 6, imports: [{ fileName: SAMPLE_FILE_NAME, added: 0, skipped: skipped.map((index) => ({ index, reason: 'duplicate' })) }] },
})

const failed = (error: Extract<ApiResult<never>, { ok: false }>['error']): ApiResult<ValidationReport> => ({ ok: false, error })

describe('parseDeckKeys', () => {
  it('collects the keys of every card', () => {
    const keys = parseDeckKeys(deckText)
    expect(keys && [...keys].sort()).toEqual([cardKey(makeCard({ word: 'when' })), cardKey(where)].sort())
  })

  it('treats missing fields like the importer does (pos stays empty)', () => {
    const keys = parseDeckKeys('[{"word":"Run","translation":"бежать"}]')
    expect(keys && [...keys]).toEqual(['run||бежать'])
  })

  it('skips rows that are not objects', () => {
    expect(parseDeckKeys('[1, null, "x", []]')?.size).toBe(0)
  })

  it('returns null for text that is not a deck', () => {
    expect(parseDeckKeys('<html>')).toBeNull()
    expect(parseDeckKeys('{"items": []}')).toBeNull()
    expect(parseDeckKeys('')).toBeNull()
  })
})

describe('buildImportScope', () => {
  const card = makeCard({ word: 'extra', translation: 'лишнее', pos: 'noun' })
  const deckCard = makeCard({ word: 'when' })

  it('keeps the deck keys when the draft is empty', () => {
    const { context, freed } = scopeOf()
    expect(context.deckKeys.size).toBe(2)
    expect(context.draftKeys.size).toBe(0)
    expect(freed.size).toBe(0)
  })

  it('counts new cards, renamed cards, restored cards and earlier files as taken', () => {
    const draft: Draft = {
      ...emptyDraft(1, 5),
      items: {
        'tmp-1': { kind: 'create', card },
        '7': { kind: 'update', baseVersion: 1, base: makeCard({ word: 'old', translation: 'старое' }), card: makeCard({ word: 'newer', translation: 'новее' }) },
        '8': { kind: 'restore', baseVersion: 2, base: makeCard({ word: 'back', translation: 'назад' }) },
        '9': { kind: 'restore', baseVersion: 2, base: makeCard({ word: 'back2', translation: 'назад2' }), card: makeCard({ word: 'edited', translation: 'правка' }) },
      },
      imports: [{ fileName: 'a.json', cards: [makeCard({ word: 'filed', translation: 'из файла' })], preview: { added: 1, skipped: 0, errors: 0 } }],
    }
    const { context } = scopeOf(draft)
    const taken = ['extra|noun|лишнее', 'newer|adv|новее', 'back|adv|назад', 'edited|adv|правка', 'filed|adv|из файла']
    expect(taken.filter((key) => !context.draftKeys.has(key))).toEqual([])
    expect(context.draftKeys.has('back2|adv|назад2')).toBe(false)
  })

  it('frees the key of an archived or renamed deck card', () => {
    const draft: Draft = {
      ...emptyDraft(1, 5),
      items: {
        '1': { kind: 'archive', baseVersion: 1, base: where },
        '2': { kind: 'update', baseVersion: 1, base: deckCard, card: makeCard({ word: 'when', translation: 'во время' }) },
      },
    }
    const { context, freed } = scopeOf(draft)
    expect([...freed].sort()).toEqual([cardKey(deckCard), cardKey(where)].sort())
    expect(context.deckKeys.size).toBe(0)
  })

  it('does not free the key of a card edited without changing its key', () => {
    const draft: Draft = {
      ...emptyDraft(1, 5),
      items: { '1': { kind: 'update', baseVersion: 1, base: where, card: { ...where, usage: 'другое' } } },
    }
    const { context, freed } = scopeOf(draft)
    expect(freed.size).toBe(0)
    expect(context.deckKeys.has(cardKey(where))).toBe(true)
  })
})

describe('the mockup scenario: «Использовать пример файла»', () => {
  it('gives 7 added / 1 already in the deck / 3 with errors', () => {
    const { analysis } = analyze(SAMPLE_TEXT)
    expect(analysis.total).toBe(11)
    expect(analysis.cards).toHaveLength(7)
    expect(analysis.duplicates).toEqual([{ index: 7, word: 'where', reason: 'deck' }])
    expect(analysis.errors.map((e) => e.word)).toEqual(['гостиница', 'passport', 'ticket'])
  })

  it('stays 7 / 1 / 3 when the server confirms', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const review = applyServerResult(analysis, okReport(), freed)
    expect([review.cards.length, review.duplicates.length, review.errors.length]).toEqual([7, 1, 3])
    expect(review.checked).toBe('server')
    expect(review.serverFound).toBe(0)
  })

  it('the sample file is the same as the fixture used by importFile tests', () => {
    expect(SAMPLE_FILE_NAME).toBe('travel-words.json')
    expect(JSON.parse(SAMPLE_TEXT)).toHaveLength(11)
  })
})

describe('cardIndices', () => {
  it('maps the cards to their rows in the file', () => {
    const { analysis } = analyze(SAMPLE_TEXT)
    expect(cardIndices(analysis)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(cardIndices(analysis)).toHaveLength(analysis.cards.length)
  })

  it('skips errors and duplicates in the middle', () => {
    const rows = [
      { word: 'one', pos: 'noun', translation: 'раз' },
      { word: 'where', pos: 'adv', translation: 'где, куда' },
      { word: 'bad word!', pos: 'noun', translation: 'плохо' },
      { word: 'two', pos: 'noun', translation: 'два' },
    ]
    const { analysis } = analyze(JSON.stringify(rows))
    expect(cardIndices(analysis)).toEqual([0, 3])
  })
})

describe('validateBody', () => {
  it('sends only this file with the valid cards', () => {
    const { analysis } = analyze(SAMPLE_TEXT)
    const body = validateBody(analysis, SAMPLE_FILE_NAME, 5)
    expect(body?.baseRevision).toBe(5)
    expect(body?.imports).toHaveLength(1)
    expect(body?.imports[0].fileName).toBe(SAMPLE_FILE_NAME)
    expect(body?.imports[0].cards).toHaveLength(7)
  })

  it('sends nothing when no row is usable', () => {
    const { analysis } = analyze('[{"word":"x y!","pos":"noun","translation":"т"}]')
    expect(validateBody(analysis, 'a.json', 5)).toBeNull()
  })
})

describe('applyServerResult', () => {
  it('moves the duplicates found by the server out of «will be added»', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const review = applyServerResult(analysis, okReport([2, 4]), freed)
    expect(review.cards.map((c) => c.word)).toEqual(['luggage', 'board', 'departure', 'check-in', 'window seat'])
    expect(review.duplicates.map((d) => [d.index, d.word, d.reason])).toEqual([
      [2, 'delay', 'deck'],
      [4, 'arrive', 'deck'],
      [7, 'where', 'deck'],
    ])
    expect(review.serverFound).toBe(2)
    expect(review.errors).toHaveLength(3)
  })

  it('maps server row numbers back to the file when earlier rows were skipped', () => {
    const rows = [
      { word: 'bad word!', pos: 'noun', translation: 'плохо' },
      { word: 'where', pos: 'adv', translation: 'где, куда' },
      { word: 'one', pos: 'noun', translation: 'раз' },
      { word: 'two', pos: 'noun', translation: 'два' },
    ]
    const { analysis, freed } = analyze(JSON.stringify(rows))
    const review = applyServerResult(analysis, okReport([1]), freed)
    expect(review.duplicates.find((d) => d.word === 'two')?.index).toBe(3)
    expect(review.cards.map((c) => c.word)).toEqual(['one'])
  })

  it('ignores a server duplicate when the draft frees that key', () => {
    const draft: Draft = { ...emptyDraft(1, 5), items: { '1': { kind: 'archive', baseVersion: 1, base: where } } }
    const text = JSON.stringify([{ word: 'where', pos: 'adv', translation: 'где, куда' }])
    const { analysis, freed } = analyze(text, draft)
    expect(analysis.cards).toHaveLength(1)
    const review = applyServerResult(analysis, okReport([0]), freed)
    expect(review.cards).toHaveLength(1)
    expect(review.duplicates).toHaveLength(0)
  })

  it('moves a row the server rejected into «with errors», with a Russian reason', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const errors: ChangesetError[] = [{ section: 'imports', index: 1, file: SAMPLE_FILE_NAME, field: 'translation', code: 'required', message: 'must be provided' }]
    const review = applyServerResult(analysis, failed({ kind: 'validation', code: 'invalid_argument', message: 'bad', errors }), freed)
    expect(review.checked).toBe('server')
    expect(review.cards.map((c) => c.word)).not.toContain('board')
    const row = review.errors.find((e) => e.word === 'board')
    expect(row?.index).toBe(1)
    expect(row?.messages).toEqual(['translation: Обязательное поле'])
    expect(review.errors).toHaveLength(4)
  })

  it('rejects the whole file when the server complains about something other than rows', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const errors: ChangesetError[] = [{ section: 'imports', index: 0, file: 'x', code: 'invalid_file_name', message: 'fileName must be 1 to 200 characters' }]
    const review = applyServerResult(analysis, failed({ kind: 'validation', code: 'invalid_argument', message: 'Сервер не принял данные.', errors }), freed)
    expect(review.checked).toBe('rejected')
    expect(review.rejection).toBe('Сервер не принял данные.')
    expect(review.cards).toHaveLength(7)
  })

  for (const error of [{ kind: 'network' }, { kind: 'server', status: 502, message: '' }, { kind: 'unauthenticated' }] as const) {
    it(`falls back to the local result on ${error.kind}`, () => {
      const { analysis, freed } = analyze(SAMPLE_TEXT)
      const review = applyServerResult(analysis, failed(error), freed)
      expect(review.checked).toBe('local')
      expect([review.cards.length, review.duplicates.length, review.errors.length]).toEqual([7, 1, 3])
    })
  }
})

describe('reviewWithoutServer', () => {
  it('is «none» when there is nothing to check', () => {
    const { analysis } = analyze('[{"word":"x y!","pos":"noun","translation":"т"}]')
    expect(reviewWithoutServer(analysis).checked).toBe('none')
  })
})

describe('draft import and the error report', () => {
  it('turns a review into a draft import with the preview counters', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const imported = toDraftImport(applyServerResult(analysis, okReport(), freed), SAMPLE_FILE_NAME)
    expect(imported.fileName).toBe('travel-words.json')
    expect(imported.cards).toHaveLength(7)
    expect(imported.preview).toEqual({ added: 7, skipped: 1, errors: 3 })
  })

  it('keeps file names within the server limit', () => {
    expect(Array.from(clipFileName('я'.repeat(MAX_FILE_NAME + 50) + '.json'))).toHaveLength(MAX_FILE_NAME)
    expect(clipFileName('  ')).toBe('import.json')
    expect(clipFileName(' words.json ')).toBe('words.json')
  })

  it('names the report after the file', () => {
    expect(errorReportName('travel-words.json')).toBe('travel-words-errors.json')
    expect(errorReportName('Words.JSON')).toBe('Words-errors.json')
    expect(errorReportName('words')).toBe('words-errors.json')
  })

  it('lists every error and duplicate with the row number and the reason', () => {
    const { analysis, freed } = analyze(SAMPLE_TEXT)
    const review = applyServerResult(analysis, okReport(), freed)
    const report = JSON.parse(buildErrorReport(SAMPLE_FILE_NAME, review))
    expect(report.fileName).toBe('travel-words.json')
    expect(report.rows).toBe(11)
    expect(report.willBeAdded).toBe(7)
    expect(report.checked).toBe('server')
    expect(report.errors).toHaveLength(3)
    expect(report.errors[0]).toMatchObject({ index: 8, row: 9, word: 'гостиница' })
    expect(report.errors[0].reasons[0]).toContain('word:')
    expect(report.skipped).toEqual([{ index: 7, row: 8, word: 'where', reason: 'deck' }])
  })

  it('marks a locally checked report', () => {
    const { analysis } = analyze(SAMPLE_TEXT)
    expect(JSON.parse(buildErrorReport('a.json', reviewWithoutServer(analysis))).checked).toBe('local')
  })
})

describe('readText', () => {
  it('reads a file through File.text()', async () => {
    const file = new File(['[{"a": "я"}]'], 'a.json', { type: 'application/json' })
    expect(await readText(file)).toBe('[{"a": "я"}]')
  })

  it('falls back to FileReader when Blob.text is missing', async () => {
    class FakeReader {
      result: string | null = null
      error: Error | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsText(blob: Blob) {
        this.result = `read:${blob.size}`
        this.onload?.()
      }
    }
    const original = (globalThis as { FileReader?: unknown }).FileReader
    ;(globalThis as { FileReader?: unknown }).FileReader = FakeReader
    try {
      const blob = new Blob(['abc'])
      Object.defineProperty(blob, 'text', { value: undefined })
      expect(await readText(blob)).toBe('read:3')
    } finally {
      ;(globalThis as { FileReader?: unknown }).FileReader = original
    }
  })
})
