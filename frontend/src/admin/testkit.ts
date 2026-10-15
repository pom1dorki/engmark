import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type CardData, type ServerCard, type ServerChange, emptyCard } from './types'

export function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    ...emptyCard(),
    word: 'when',
    translation: 'когда',
    pos: 'adv',
    example: 'When I was your age, phones had buttons.',
    exampleHighlight: 'When',
    exampleTranslation: 'Когда я был в твоём возрасте, у телефонов были кнопки.',
    ...overrides,
  }
}

export function makeServerCard(id: number, version: number, overrides: Partial<ServerCard> = {}): ServerCard {
  return {
    ...makeCard(),
    id,
    version,
    archived: false,
    archivedAt: null,
    createdRevision: 1,
    updatedRevision: version,
    updatedAt: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

export function makeChange(current: ServerCard, base: Partial<CardData> | null): ServerChange {
  return {
    current,
    base: base
      ? { cardId: current.id, version: 1, revision: 1, archived: false, createdAt: '2026-10-01T10:00:00Z', card: makeCard(base) }
      : null,
  }
}

export function readFrontendFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}
