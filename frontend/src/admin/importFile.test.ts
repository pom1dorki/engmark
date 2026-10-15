import { describe, expect, it } from 'vitest'
import { analyzeImport, type ImportContext } from './importFile'
import { readFrontendFile } from './testkit'
import { cardKey, emptyCard } from './types'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from './validate/rules'

const travel = readFrontendFile('src/admin/fixtures/travel-words.json')

const none: ImportContext = { deckKeys: new Set(), draftKeys: new Set() }

function keyOf(word: string, pos: string, translation: string): string {
  return cardKey({ ...emptyCard(), word, pos, translation })
}

function ok(text: string, context: ImportContext = none) {
  const result = analyzeImport(text, context)
  if (!result.ok) throw new Error(`import failed: ${result.failure}`)
  return result
}

describe('analyzeImport: the scenario from the mockup', () => {
  const deck: ImportContext = { deckKeys: new Set([keyOf('where', 'adv', 'где, куда')]), draftKeys: new Set() }

  it('gives 7 / 1 / 3', () => {
    const result = ok(travel, deck)
    expect(result.total).toBe(11)
    expect(result.cards).toHaveLength(7)
    expect(result.duplicates).toHaveLength(1)
    expect(result.errors).toHaveLength(3)
  })

  it('points at the right rows', () => {
    const result = ok(travel, deck)
    expect(result.cards.map((c) => c.word)).toEqual(['luggage', 'board', 'delay', 'departure', 'arrive', 'check-in', 'window seat'])
    expect(result.duplicates).toEqual([{ index: 7, word: 'where', reason: 'deck' }])
    expect(result.errors.map((e) => [e.index, e.word])).toEqual([
      [8, 'гостиница'],
      [9, 'passport'],
      [10, 'ticket'],
    ])
  })

  it('explains each error', () => {
    const [cyrillic, pos, highlight] = ok(travel, deck).errors
    expect(cyrillic.messages.join(' ')).toContain('word:')
    expect(pos.messages.join(' ')).toContain('pos:')
    expect(highlight.messages.join(' ')).toContain('exampleHighlight:')
  })
})

describe('analyzeImport: whole-file failures', () => {
  const cases: [string, string, string][] = [
    ['broken JSON', '{"word": ', 'invalid_json'],
    ['empty text', '', 'invalid_json'],
    ['an object instead of an array', '{"word":"a","pos":"noun","translation":"б"}', 'not_array'],
    ['a string', '"cards"', 'not_array'],
    ['an empty array', '[]', 'empty'],
  ]
  for (const [name, text, failure] of cases) {
    it(name, () => {
      const result = analyzeImport(text, none)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.failure).toBe(failure)
        expect(result.message).toMatch(/[А-Яа-я]/)
      }
    })
  }

  it('too many rows', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ word: `w${i}`, pos: 'noun', translation: 'х' }))
    const result = analyzeImport(JSON.stringify(rows), none)
    expect(result.ok === false && result.failure).toBe('too_many_rows')
  })

  it('accepts exactly the row limit', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'
    const word = (i: number) => letters[i % 26] + letters[Math.floor(i / 26) % 26] + letters[Math.floor(i / 676) % 26] + letters[Math.floor(i / 17576) % 26]
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ word: word(i), pos: 'noun', translation: 'х' }))
    const result = ok(JSON.stringify(rows))
    expect(result.cards).toHaveLength(MAX_IMPORT_ROWS)
  })

  it('a file over 4 MB is refused before parsing', () => {
    const result = analyzeImport(' '.repeat(MAX_IMPORT_BYTES + 1), none)
    expect(result.ok === false && result.failure).toBe('too_large')
  })

  it('counts bytes, not characters', () => {
    const result = analyzeImport('я'.repeat(MAX_IMPORT_BYTES / 2 + 1), none)
    expect(result.ok === false && result.failure).toBe('too_large')
  })
})

describe('analyzeImport: rows', () => {
  it('ignores a BOM at the start of the file', () => {
    const result = ok('﻿' + JSON.stringify([{ word: 'a', pos: 'noun', translation: 'б' }]))
    expect(result.cards).toHaveLength(1)
  })

  it('trims values and fills missing optional fields with empty strings', () => {
    const [card] = ok(JSON.stringify([{ word: '  luggage ', pos: 'noun', translation: ' багаж\n' }])).cards
    expect(card).toEqual({ ...emptyCard(), word: 'luggage', pos: 'noun', translation: 'багаж' })
  })

  it('drops unknown fields: the server reads changesets strictly', () => {
    const [card] = ok(JSON.stringify([{ id: 7, word: 'a', pos: 'noun', translation: 'б', tags: ['x'] }])).cards
    expect(Object.keys(card).sort()).toEqual(Object.keys(emptyCard()).sort())
  })

  it('rejects rows that are not objects', () => {
    const result = ok(JSON.stringify([1, null, 'text', ['a'], { word: 'a', pos: 'noun', translation: 'б' }]))
    expect(result.errors.map((e) => e.index)).toEqual([0, 1, 2, 3])
    expect(result.cards).toHaveLength(1)
  })

  it('rejects a field of the wrong type', () => {
    const result = ok(JSON.stringify([{ word: 'a', pos: 'noun', translation: 5 }]))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].messages.join(' ')).toContain('translation')
  })

  it('a missing pos is an error, not a silent noun', () => {
    const result = ok(JSON.stringify([{ word: 'a', translation: 'б' }]))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].messages.join(' ')).toContain('pos')
  })

  it('reports every problem of a row, not just the first', () => {
    const result = ok(JSON.stringify([{ word: '', pos: 'x', translation: '' }]))
    expect(result.errors[0].messages).toHaveLength(3)
  })
})

describe('analyzeImport: duplicates', () => {
  const row = (word: string, translation = 'б', pos = 'noun') => ({ word, pos, translation })

  it('repeats inside the file', () => {
    const result = ok(JSON.stringify([row('Board'), row('board'), row('board', 'другое')]))
    expect(result.cards.map((c) => c.translation)).toEqual(['б', 'другое'])
    expect(result.duplicates).toEqual([{ index: 1, word: 'board', reason: 'file' }])
  })

  it('against the deck, ignoring the case of the word', () => {
    const context = { deckKeys: new Set([keyOf('board', 'noun', 'б')]), draftKeys: new Set<string>() }
    const result = ok(JSON.stringify([row('BOARD')]), context)
    expect(result.duplicates).toEqual([{ index: 0, word: 'BOARD', reason: 'deck' }])
    expect(result.cards).toEqual([])
  })

  it('translation and part of speech are part of the key', () => {
    const context = { deckKeys: new Set([keyOf('board', 'noun', 'б')]), draftKeys: new Set<string>() }
    const result = ok(JSON.stringify([row('board', 'в'), row('board', 'б', 'verb')]), context)
    expect(result.cards).toHaveLength(2)
    expect(result.duplicates).toEqual([])
  })

  it('against the draft: new cards and other files', () => {
    const context = { deckKeys: new Set<string>(), draftKeys: new Set([keyOf('delay', 'noun', 'задержка')]) }
    const result = ok(JSON.stringify([row('delay', 'задержка')]), context)
    expect(result.duplicates).toEqual([{ index: 0, word: 'delay', reason: 'draft' }])
  })

  it('the deck wins when a row repeats both the deck and the draft', () => {
    const key = keyOf('delay', 'noun', 'задержка')
    const result = ok(JSON.stringify([row('delay', 'задержка')]), { deckKeys: new Set([key]), draftKeys: new Set([key]) })
    expect(result.duplicates[0].reason).toBe('deck')
  })

  it('a row with errors is not also counted as a duplicate', () => {
    const context = { deckKeys: new Set([keyOf('a', 'noun', 'б')]), draftKeys: new Set<string>() }
    const result = ok(JSON.stringify([{ word: 'a', pos: 'noun', translation: 'б', example: 'x', exampleHighlight: 'y' }]), context)
    expect(result.errors).toHaveLength(1)
    expect(result.duplicates).toEqual([])
  })
})
