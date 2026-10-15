import { describe, expect, it } from 'vitest'
import { readFrontendFile } from '../testkit'
import { emptyCard, type CardData } from '../types'
import { trimCard, validateCard } from './validate'

interface Case {
  name: string
  card: CardData
  errors: { field: string; code: string }[]
}

const cases: Case[] = JSON.parse(
  readFrontendFile('../backend/internal/features/catalog/domain/testdata/validate_cases.json'),
)

describe('validateCard shares its rules with the Go backend', () => {
  it('has the shared fixtures', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
  })

  for (const tc of cases) {
    it(tc.name, () => {
      const got = validateCard(tc.card).map((issue) => `${issue.field}:${issue.code}`)
      const want = tc.errors.map((e) => `${e.field}:${e.code}`)
      expect(got).toEqual(want)
    })
  }
})

describe('validateCard messages', () => {
  it('explains every issue in Russian', () => {
    const issues = validateCard({ ...emptyCard(), word: 'слово', translation: '', pos: 'x', example: 'a', exampleHighlight: 'b' })
    expect(issues.length).toBe(4)
    for (const issue of issues) expect(issue.message).toMatch(/[А-Яа-я]/)
  })

  it('counts characters, not UTF-16 units', () => {
    const card = { ...emptyCard(), word: 'a', translation: '😀'.repeat(300) }
    expect(validateCard(card)).toEqual([])
    expect(validateCard({ ...card, translation: '😀'.repeat(301) }).map((i) => i.code)).toEqual(['too_long'])
  })
})

describe('trimCard', () => {
  it('trims every field', () => {
    const trimmed = trimCard({ ...emptyCard(), word: '  luggage ', translation: ' багаж\n' })
    expect(trimmed.word).toBe('luggage')
    expect(trimmed.translation).toBe('багаж')
  })
})
