import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { restoreDeck, saveProgress, shuffleCards, stepBack, stepForward } from "./order"

type Card = { id: number }

function cards(...ids: number[]): Card[] {
  return ids.map((id) => ({ id }))
}

function ids(items: Card[]) {
  return items.map((item) => item.id)
}

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage())
  vi.spyOn(Math, "random").mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("shuffleCards", () => {
  it("returns a permutation and leaves the input in place", () => {
    const items = cards(1, 2, 3, 4)
    expect(ids(shuffleCards(items))).toEqual([2, 3, 4, 1])
    expect(ids(items)).toEqual([1, 2, 3, 4])
  })
})

describe("restoreDeck", () => {
  it("shuffles when nothing is saved", () => {
    expect(restoreDeck(cards(1, 2, 3, 4))).toEqual({
      items: cards(2, 3, 4, 1),
      index: 0,
    })
  })

  it("restores a saved permutation and index", () => {
    saveProgress(1, [3, 1, 2])
    expect(restoreDeck(cards(1, 2, 3))).toEqual({
      items: cards(3, 1, 2),
      index: 1,
    })
  })

  it("shuffles again when the saved order is the catalog order", () => {
    localStorage.setItem(
      "ew-progress",
      JSON.stringify({ index: 2, order: [1, 2, 3, 4], wordsLen: 4 }),
    )
    expect(restoreDeck(cards(1, 2, 3, 4))).toEqual({
      items: cards(2, 3, 4, 1),
      index: 0,
    })
  })

  it("keeps the saved place when the catalog gains a card", () => {
    localStorage.setItem(
      "ew-progress",
      JSON.stringify({ index: 0, order: [1], wordsLen: 1 }),
    )
    expect(restoreDeck(cards(1, 2))).toEqual({
      items: cards(1, 2),
      index: 0,
    })
  })

  it("drops removed cards, shifts the index, and inserts new cards after the current one", () => {
    localStorage.setItem(
      "ew-progress",
      JSON.stringify({ index: 2, order: [1, 2, 3, 4], wordsLen: 4 }),
    )
    expect(restoreDeck(cards(1, 3, 4, 5))).toEqual({
      items: cards(1, 3, 5, 4),
      index: 1,
    })
  })

  it("shows the next card when the current one was removed", () => {
    localStorage.setItem(
      "ew-progress",
      JSON.stringify({ index: 1, order: [1, 2, 3], wordsLen: 3 }),
    )
    expect(restoreDeck(cards(1, 3))).toEqual({
      items: cards(1, 3),
      index: 1,
    })
  })

  it("lands on the first new card when the current last card was removed", () => {
    localStorage.setItem(
      "ew-progress",
      JSON.stringify({ index: 1, order: [1, 2], wordsLen: 2 }),
    )
    expect(restoreDeck(cards(1, 3))).toEqual({
      items: cards(1, 3),
      index: 1,
    })
  })

  it("shuffles again when the saved progress is corrupt", () => {
    const bad = [
      "{",
      JSON.stringify({ index: 0, order: [1, 1], wordsLen: 2 }),
      JSON.stringify({ index: 0, order: [1, 1.5], wordsLen: 2 }),
      JSON.stringify({ index: 2, order: [2, 1], wordsLen: 2 }),
      JSON.stringify({ index: -1, order: [2, 1], wordsLen: 2 }),
    ]
    for (const raw of bad) {
      localStorage.setItem("ew-progress", raw)
      expect(restoreDeck(cards(1, 2))).toEqual({
        items: cards(2, 1),
        index: 0,
      })
    }
  })
})

describe("saveProgress", () => {
  it("keeps the visit going when storage rejects the write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied")
      },
    })
    expect(() => saveProgress(0, [1, 2])).not.toThrow()
  })
})

describe("stepForward", () => {
  it("keeps an empty deck at its index", () => {
    expect(stepForward([], 5)).toEqual({ items: [], index: 5 })
  })

  it("stays on the only card", () => {
    const items = cards(7)
    expect(stepForward(items, 3)).toEqual({ items, index: 0 })
  })

  it("advances without changing the remaining order when the next card is already next", () => {
    const items = cards(1, 2, 3)
    const next = stepForward(items, 0)
    expect(next).toEqual({ items: cards(1, 2, 3), index: 1 })
    expect(ids(items)).toEqual([1, 2, 3])
  })

  it("starts a new pass on a different card", () => {
    const next = stepForward(cards(1, 2), 1)
    expect(next.index).toBe(0)
    expect(next.items[0]?.id).not.toBe(2)
    expect(ids(next.items).sort()).toEqual([1, 2])
  })
})

describe("stepBack", () => {
  it("wraps from the first card and steps back otherwise", () => {
    expect(stepBack(cards(1, 2, 3), 0)).toBe(2)
    expect(stepBack(cards(1, 2, 3), 2)).toBe(1)
    expect(stepBack([], 4)).toBe(4)
  })
})
