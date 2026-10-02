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

async function fetchCardPage(base: string, offset: number, signal?: AbortSignal): Promise<CardList> {
  let response: Response
  try {
    response = await fetch(`${base}/api/v1/cards?limit=100&offset=${offset}`, { signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new CatalogError("API unavailable")
  }

  if (!response.ok) {
    throw new CatalogError(`catalog request failed: ${response.status}`)
  }

  return response.json() as Promise<CardList>
}

export async function listCards(signal?: AbortSignal): Promise<CardList> {
  const base = import.meta.env.VITE_API_BASE_URL
  // An empty base is the hosted site: the page and the API share one origin.
  if (base == null) {
    throw new CatalogError("VITE_API_BASE_URL is not set")
  }

  const root = base.replace(/\/$/, "")
  const items: Card[] = []
  const seen = new Set<number>()
  let offset = 0
  let total = 0
  for (;;) {
    const page = await fetchCardPage(root, offset, signal)
    total = page.total
    for (const card of page.items) {
      if (seen.has(card.id)) continue
      seen.add(card.id)
      items.push(card)
    }
    if (page.items.length === 0 || items.length >= total) break
    const next = offset + page.items.length
    if (next <= offset) break
    offset = next
  }

  return { items, total, limit: items.length, offset: 0 }
}