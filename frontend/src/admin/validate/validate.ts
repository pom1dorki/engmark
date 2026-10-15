import { type CardData, type CardField, POS_VALUES } from '../types'
import {
  MAX_EXAMPLE,
  MAX_NOTE,
  MAX_TRANSLATION,
  MAX_WORD,
  WORD_PATTERN,
  type FieldCode,
} from './rules'

export interface FieldIssue {
  field: CardField
  code: FieldCode
  message: string
}

const MESSAGES: Record<FieldCode, (field: CardField) => string> = {
  required: () => 'Обязательное поле',
  invalid_chars: () => 'Только латиница, апостроф, дефис и одиночные пробелы',
  too_long: (field) => `Слишком длинно (не больше ${limitOf(field)} символов)`,
  unsupported_pos: () => 'Допустимо: глагол, существительное, прилагательное, наречие',
  highlight_not_found: () => 'Не найдено в предложении',
}

export function issueMessage(field: CardField, code: FieldCode): string {
  return MESSAGES[code](field)
}

function limitOf(field: CardField): number {
  switch (field) {
    case 'word':
      return MAX_WORD
    case 'translation':
      return MAX_TRANSLATION
    case 'example':
      return MAX_EXAMPLE
    default:
      return MAX_NOTE
  }
}

function runes(value: string): number {
  return Array.from(value).length
}

export function validateCard(card: CardData): FieldIssue[] {
  const issues: FieldIssue[] = []
  const add = (field: CardField, code: FieldCode) => issues.push({ field, code, message: issueMessage(field, code) })

  if (card.word === '') add('word', 'required')
  else if (!WORD_PATTERN.test(card.word)) add('word', 'invalid_chars')
  else if (runes(card.word) > MAX_WORD) add('word', 'too_long')

  if (card.translation === '') add('translation', 'required')
  else if (runes(card.translation) > MAX_TRANSLATION) add('translation', 'too_long')

  if (card.pos === '') add('pos', 'required')
  else if (!(POS_VALUES as readonly string[]).includes(card.pos)) add('pos', 'unsupported_pos')

  if (runes(card.example) > MAX_EXAMPLE) add('example', 'too_long')
  const notes: CardField[] = [
    'ipa',
    'pronunciation',
    'stressNote',
    'grammar',
    'usage',
    'exampleHighlight',
    'exampleTranslation',
  ]
  for (const field of notes) {
    if (runes(card[field]) > MAX_NOTE) add(field, 'too_long')
  }

  if (card.exampleHighlight !== '' && !card.example.toLowerCase().includes(card.exampleHighlight.toLowerCase())) {
    add('exampleHighlight', 'highlight_not_found')
  }
  return issues
}

export function trimCard(card: CardData): CardData {
  const out = { ...card }
  for (const key of Object.keys(out) as CardField[]) out[key] = out[key].trim()
  return out
}
