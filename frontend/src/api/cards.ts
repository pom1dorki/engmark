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

export async function listCards(signal?: AbortSignal): Promise<CardList> {
  const base = import.meta.env.VITE_API_BASE_URL
  // An empty base is the hosted site: the page and the API share one origin.
  if (base == null) {
    throw new CatalogError("VITE_API_BASE_URL is not set")
  }

  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v1/cards?limit=100`, { signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new CatalogError("API unavailable")
  }

  if (!response.ok) {
    throw new CatalogError(`catalog request failed: ${response.status}`)
  }

  return response.json() as Promise<CardList>
}