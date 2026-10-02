export function shuffleCards<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = copy[i]
    copy[i] = copy[j]
    copy[j] = current
  }
  return copy
}

type SavedProgress = {
  index: number
  order: number[]
  wordsLen: number
}

const progressKey = "ew-progress"

function readSaved(ids: number[]): SavedProgress | null {
  try {
    const raw = localStorage.getItem(progressKey)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedProgress
    if (!data || data.wordsLen !== ids.length || !Array.isArray(data.order)) return null
    if (!Number.isInteger(data.index) || data.index < 0 || data.index >= ids.length) return null
    const seen = new Set<number>()
    for (const id of data.order) {
      if (!Number.isInteger(id) || !ids.includes(id) || seen.has(id)) return null
      seen.add(id)
    }
    if (seen.size !== ids.length) return null
    // A saved copy of the catalog order is the sequence the screen used to follow.
    if (data.order.every((id, i) => id === ids[i])) return null
    return data
  } catch {
    return null
  }
}

export function restoreDeck<T extends { id: number }>(items: T[]): { items: T[]; index: number } {
  const saved = readSaved(items.map((item) => item.id))
  if (!saved) return { items: shuffleCards(items), index: 0 }
  const byId = new Map(items.map((item) => [item.id, item]))
  return {
    items: saved.order.map((id) => byId.get(id)!),
    index: saved.index,
  }
}

export function saveProgress(index: number, ids: number[]) {
  try {
    localStorage.setItem(progressKey, JSON.stringify({ index, order: ids, wordsLen: ids.length }))
  } catch {
    // Private mode can reject storage. The deck still works for this visit.
  }
}

export function stepForward<T extends { id: number }>(items: T[], index: number): { items: T[]; index: number } {
  if (items.length === 0) return { items, index }
  if (items.length === 1) return { items, index: 0 }
  const prevId = items[index]?.id
  const nextIndex = index + 1
  if (nextIndex < items.length) {
    const pick = nextIndex + Math.floor(Math.random() * (items.length - nextIndex))
    if (pick === nextIndex) return { items, index: nextIndex }
    const next = items.slice()
    const chosen = next[pick]
    next[pick] = next[nextIndex]
    next[nextIndex] = chosen
    return { items: next, index: nextIndex }
  }
  const next = shuffleCards(items)
  if (next[0].id === prevId) {
    const first = next[0]
    next[0] = next[1]
    next[1] = first
  }
  return { items: next, index: 0 }
}

export function stepBack<T>(items: T[], index: number) {
  if (items.length === 0) return index
  return (index - 1 + items.length) % items.length
}
