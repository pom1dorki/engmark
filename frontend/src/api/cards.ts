export type Card = {
  id: number
  deckId: number
  version: number
  word: string
  translation: string
  ipa: string
  pronunciation: string
  stressNote: string
  pos: string
  posRu: string
  grammar: string
  usage: string
  example: string
  exampleHighlight: string
  exampleTranslation: string
  createdAt: string
  updatedAt: string
}

export type CardList = {
  items: Card[]
  total: number
  limit: number
  offset: number
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CatalogError"
  }
}

function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError"
}

export const pageSize = 1000

export function cardsUrl(offset: number) {
  return `/api/v1/cards?limit=${pageSize}&offset=${offset}`
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false
  const card = value as Record<string, unknown>
  const strings = [
    card.word,
    card.translation,
    card.ipa,
    card.pronunciation,
    card.stressNote,
    card.pos,
    card.posRu,
    card.grammar,
    card.usage,
    card.example,
    card.exampleHighlight,
    card.exampleTranslation,
  ]
  return typeof card.id === "number" && Number.isInteger(card.id) && strings.every((item) => typeof item === "string")
}

function parseCardList(payload: unknown): CardList & { pageCount: number } {
  if (!payload || typeof payload !== "object") {
    throw new CatalogError("catalog response is not an object")
  }
  const body = payload as Record<string, unknown>
  if (!Array.isArray(body.items)) {
    throw new CatalogError("catalog items are not an array")
  }
  const items: Card[] = []
  for (const item of body.items) {
    if (!isCard(item)) {
      console.warn("skipping catalog card", item)
      continue
    }
    items.push(item)
  }
  return {
    items,
    pageCount: body.items.length,
    total: typeof body.total === "number" ? body.total : items.length,
    limit: typeof body.limit === "number" ? body.limit : items.length,
    offset: typeof body.offset === "number" ? body.offset : 0,
  }
}

type CardPage = CardList & { pageCount: number }

async function fetchCardPage(offset: number, signal?: AbortSignal): Promise<CardPage> {
  let response: Response
  try {
    response = await fetch(cardsUrl(offset), { signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new CatalogError("API unavailable")
  }

  if (!response.ok) {
    throw new CatalogError(`catalog request failed: ${response.status}`)
  }

  return parseCardList(await response.json())
}

export async function listCards(signal?: AbortSignal): Promise<CardList> {
  const items: Card[] = []
  const seen = new Set<number>()
  let offset = 0
  let total: number | undefined
  for (;;) {
    const page = await fetchCardPage(offset, signal)
    total = page.total
    for (const card of page.items) {
      if (seen.has(card.id)) continue
      seen.add(card.id)
      items.push(card)
    }
    if (page.pageCount === 0 || items.length >= total) break
    const next = offset + page.pageCount
    if (next <= offset || next >= total) break
    offset = next
  }

  return { items, total: total ?? 0, limit: items.length, offset: 0 }
}