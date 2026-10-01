export type Card = {
  id: number
  deckId: number
  version: number
  word: string
  translation: string
  ipa: string
  rusTrans: string
  stress: string
  pos: string
  posRu: string
  extraLabel: string
  extra: string
  style: string
  example: string
  exampleHighlight: string
  exampleRu: string
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

export async function listCards(): Promise<CardList> {
  const base = import.meta.env.VITE_API_BASE_URL
  if (!base) {
    throw new CatalogError("VITE_API_BASE_URL is not set")
  }

  let response: Response
  try {
    response = await fetch(`${base}/api/v1/cards?limit=100`)
  } catch {
    throw new CatalogError("API unavailable")
  }

  if (!response.ok) {
    throw new CatalogError(`catalog request failed: ${response.status}`)
  }

  return response.json() as Promise<CardList>
}