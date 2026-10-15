import { describe, expect, it } from 'vitest'
import { labelReason, plural } from './labels'

describe('plural', () => {
  const word = (n: number) => plural(n, 'новое слово', 'новых слова', 'новых слов')

  it('picks the Russian form by the number', () => {
    const forms: [number, string][] = [
      [0, 'новых слов'],
      [1, 'новое слово'],
      [2, 'новых слова'],
      [4, 'новых слова'],
      [5, 'новых слов'],
      [11, 'новых слов'],
      [12, 'новых слов'],
      [14, 'новых слов'],
      [21, 'новое слово'],
      [22, 'новых слова'],
      [25, 'новых слов'],
      [101, 'новое слово'],
      [111, 'новых слов'],
      [112, 'новых слов'],
    ]
    expect(forms.map(([n]) => [n, word(n)])).toEqual(forms)
  })
})

describe('labelReason', () => {
  it('replaces the field name with its label', () => {
    expect(labelReason('word: Обязательное поле')).toBe('Слово: Обязательное поле')
    expect(labelReason('exampleHighlight: Не найдено в предложении')).toBe('Выделить: Не найдено в предложении')
  })

  it('leaves other messages alone', () => {
    expect(labelReason('Строка должна быть объектом')).toBe('Строка должна быть объектом')
    expect(labelReason('Поле «word» должно быть строкой')).toBe('Поле «word» должно быть строкой')
    expect(labelReason('constructor: странно')).toBe('constructor: странно')
    expect(labelReason(': пусто')).toBe(': пусто')
  })
})
