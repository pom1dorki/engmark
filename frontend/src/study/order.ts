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

function isCatalogOrder(order: number[], ids: number[]) {
  return order.length === ids.length && order.every((id, i) => id === ids[i])
}

function reconcile(data: SavedProgress, ids: number[]): { order: number[]; index: number } | null {
  if (!Array.isArray(data.order)) return null
  if (!Number.isInteger(data.index) || data.index < 0 || data.index >= data.order.length) return null
  if (isCatalogOrder(data.order, ids)) return null

  const idSet = new Set(ids)
  const seen = new Set<number>()
  const kept: number[] = []
  let removedBefore = 0
  for (let i = 0; i < data.order.length; i += 1) {
    const id = data.order[i]
    if (!Number.isInteger(id) || seen.has(id)) return null
    seen.add(id)
    if (!idSet.has(id)) {
      if (i < data.index) removedBefore += 1
      continue
    }
    kept.push(id)
  }

  let index = data.index - removedBefore
  if (index < 0) index = 0
  if (index > kept.length) index = kept.length

  const prefixEnd = index < kept.length ? index + 1 : kept.length
  const prefix = kept.slice(0, prefixEnd)
  const upcoming = kept.slice(prefixEnd)
  const keptSet = new Set(kept)
  const fresh = shuffleCards(ids.filter((id) => !keptSet.has(id)))
  const slot = Math.floor(Math.random() * (upcoming.length + 1))
  const order = prefix.concat(upcoming.slice(0, slot), fresh, upcoming.slice(slot))
  if (order.length === 0) return null
  if (index >= order.length) index = 0
  return { order, index }
}

function readSaved(ids: number[]): { order: number[]; index: number } | null {
  try {
    const raw = localStorage.getItem(progressKey)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedProgress
    if (!data) return null
    return reconcile(data, ids)
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
    return
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
