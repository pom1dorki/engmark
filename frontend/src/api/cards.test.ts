import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CatalogError, cardsUrl, listCards, pageSize, type Card } from "./cards"

function card(id: number, word = "alpha"): Card {
  return {
    id,
    deckId: 1,
    version: 1,
    word,
    translation: "альфа",
    ipa: "ˈælfə",
    pronunciation: "альфа",
    stressNote: "",
    pos: "noun",
    posRu: "сущ.",
    grammar: "",
    usage: "",
    example: "Alpha.",
    exampleHighlight: "Alpha",
    exampleTranslation: "Альфа.",
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-01-01T00:00:00Z",
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("cardsUrl", () => {
  it("matches the preload URL in index.html", () => {
    const html = readFileSync(resolve("index.html"), "utf8")
    expect(cardsUrl(0)).toBe(`/api/v1/cards?limit=${pageSize}&offset=0`)
    expect(html).toContain(`href="${cardsUrl(0)}"`)
    expect(html).toContain('rel="preload"')
    expect(html).toContain('as="fetch"')
    expect(html).toContain('crossorigin="anonymous"')
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
  })
})

describe("listCards", () => {
  it("drops a broken card and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [{ id: "nope" }, card(4, "kept")],
      total: 2,
      limit: 1000,
      offset: 0,
    })))

    const list = await listCards()
    expect(list.items.map((item) => item.id)).toEqual([4])
    expect(warn).toHaveBeenCalled()
  })

  it("rejects a payload whose items are not an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: null, total: 0, limit: 0, offset: 0 })))
    await expect(listCards()).rejects.toBeInstanceOf(CatalogError)
  })
})
