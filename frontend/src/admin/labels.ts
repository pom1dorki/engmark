import type { ApiError } from './api/admin'
import { describeError } from './api/admin'
import type { CardField } from './types'

export const POS_SHORT: Record<string, string> = {
  verb: 'глагол',
  noun: 'сущ.',
  adj: 'прил.',
  adv: 'нареч.',
}

export const POS_FULL: Record<string, string> = {
  verb: 'Глагол',
  noun: 'Существительное',
  adj: 'Прилагательное',
  adv: 'Наречие',
}

export const POS_SEGMENTS: { value: string; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'verb', label: 'Глаг.' },
  { value: 'noun', label: 'Сущ.' },
  { value: 'adj', label: 'Прил.' },
  { value: 'adv', label: 'Нар.' },
]

export const FIELD_LABELS: Record<CardField, string> = {
  word: 'Слово',
  pos: 'Часть речи',
  translation: 'Перевод',
  ipa: 'IPA',
  pronunciation: 'Русскими буквами',
  stressNote: 'Ударение',
  grammar: 'Грамматика',
  usage: 'Контекст и стиль',
  example: 'Предложение',
  exampleHighlight: 'Выделить',
  exampleTranslation: 'Перевод примера',
}

export function posShort(pos: string): string {
  return POS_SHORT[pos] ?? pos
}

export function describeLoginError(error: ApiError): string {
  switch (error.kind) {
    case 'unauthenticated':
    case 'too_many_requests':
      return 'Неверный пароль или слишком много попыток. Подождите минуту.'
    case 'not_found':
      return 'Админка выключена на сервере: не задан ADMIN_PASSWORD_HASH.'
    default:
      return describeError(error)
  }
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function plural(n: number, one: string, few: string, many: string): string {
  const last = Math.abs(n) % 10
  const lastTwo = Math.abs(n) % 100
  if (last === 1 && lastTwo !== 11) return one
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few
  return many
}

export function labelReason(message: string): string {
  const cut = message.indexOf(': ')
  const field = message.slice(0, cut)
  return cut > 0 && Object.hasOwn(FIELD_LABELS, field) ? `${FIELD_LABELS[field as CardField]}: ${message.slice(cut + 2)}` : message
}
