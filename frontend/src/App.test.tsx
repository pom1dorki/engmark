import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import type { Card } from "./api/cards"

function card(id: number, word: string): Card {
  return {
    id,
    deckId: 1,
    version: 1,
    word,
    translation: `${word}-ru`,
    ipa: "",
    pronunciation: "",
    stressNote: "",
    pos: "noun",
    posRu: "сущ.",
    grammar: "",
    usage: "",
    example: word,
    exampleHighlight: word,
    exampleTranslation: "",
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-01-01T00:00:00Z",
  }
}

function page(items: Card[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items, total: items.length, limit: 1000, offset: 0 }),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Math, "random").mockReturnValue(0)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("App", () => {
  it("restores progress and moves with keys and the next button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([card(1, "alpha"), card(2, "beta")])))
    const view = render(<App />)
    expect(await screen.findByRole("heading", { level: 2, name: "beta" })).toBeTruthy()
    expect(screen.getByLabelText("Карточка 1 из 2")).toBeTruthy()

    fireEvent.keyDown(window, { code: "Space", key: " " })
    expect(screen.getByRole("heading", { level: 2, name: "alpha" })).toBeTruthy()

    fireEvent.keyDown(window, { code: "ArrowLeft", key: "ArrowLeft" })
    expect(screen.getByRole("heading", { level: 2, name: "beta" })).toBeTruthy()

    fireEvent.keyDown(window, { code: "KeyJ", key: "j" })
    expect(screen.getByRole("heading", { level: 2, name: "alpha" })).toBeTruthy()

    fireEvent.keyDown(window, { code: "KeyK", key: "k" })
    expect(screen.getByRole("heading", { level: 2, name: "beta" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Другое слово" }))
    expect(screen.getByRole("heading", { level: 2, name: "alpha" })).toBeTruthy()

    const next = screen.getByRole("button", { name: "Другое слово" })
    fireEvent.keyDown(next, { code: "Space", key: " " })
    expect(screen.getByRole("heading", { level: 2, name: "alpha" })).toBeTruthy()

    view.unmount()
    render(<App />)
    expect(await screen.findByRole("heading", { level: 2, name: "alpha" })).toBeTruthy()
    expect(screen.getByLabelText("Карточка 2 из 2")).toBeTruthy()
  })

  it("retries a failed load", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1
      if (calls === 1) return { ok: false, status: 500, json: async () => ({}) }
      return page([card(3, "gamma")])
    }))
    render(<App />)
    expect(await screen.findByRole("button", { name: "Повторить" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }))
    expect(await screen.findByRole("heading", { level: 2, name: "gamma" })).toBeTruthy()
  })

  it("moves the theme with arrows and leaves the card in place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([card(1, "alpha"), card(2, "beta")])))
    render(<App />)
    expect(await screen.findByRole("heading", { level: 2, name: "beta" })).toBeTruthy()

    const dark = screen.getByRole("radio", { name: "Тёмная тема" })
    const light = screen.getByRole("radio", { name: "Светлая тема" })
    expect(dark.tabIndex).toBe(0)
    expect(light.tabIndex).toBe(-1)

    dark.focus()
    fireEvent.keyDown(dark, { key: "ArrowRight", code: "ArrowRight" })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"))
    expect(screen.getByRole("heading", { level: 2, name: "beta" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: "Светлая тема" }).tabIndex).toBe(0)
  })

  it("explains when speech is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([card(1, "alpha")])))
    render(<App />)
    const speak = await screen.findByRole("button", { name: "Произнести слово" })
    expect(speak.getAttribute("title")).toBe("Озвучка не поддерживается браузером")
    expect((speak as HTMLButtonElement).disabled).toBe(true)
  })
})
