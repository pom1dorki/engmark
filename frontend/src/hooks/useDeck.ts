import { useCallback, useEffect, useReducer, useState } from "react"
import { listCards, type Card } from "../api/cards"
import { restoreDeck, saveProgress, stepBack, stepForward } from "../study/order"

export type DeckStatus = "loading" | "ready" | "empty" | "error"

type DeckState = {
  status: DeckStatus
  cards: Card[]
  index: number
}

type DeckAction =
  | { type: "loaded"; items: Card[] }
  | { type: "failed" }
  | { type: "retry" }
  | { type: "next" }
  | { type: "prev" }

export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  switch (action.type) {
    case "loaded": {
      if (action.items.length === 0) return { status: "empty", cards: [], index: 0 }
      const deck = restoreDeck(action.items)
      return { status: "ready", cards: deck.items, index: deck.index }
    }
    case "failed":
      return { status: "error", cards: [], index: 0 }
    case "retry":
      return { ...state, status: "loading" }
    case "next": {
      const next = stepForward(state.cards, state.index)
      return { ...state, cards: next.items, index: next.index }
    }
    case "prev":
      return { ...state, index: stepBack(state.cards, state.index) }
    default:
      return state
  }
}

const initialDeck: DeckState = { status: "loading", cards: [], index: 0 }

export function useDeck() {
  const [state, dispatch] = useReducer(deckReducer, initialDeck)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listCards(controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return
        dispatch({ type: "loaded", items: list.items })
      },
      (err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return
        dispatch({ type: "failed" })
      },
    )
    return () => {
      controller.abort()
    }
  }, [reload])

  useEffect(() => {
    if (state.status !== "ready") return
    saveProgress(state.index, state.cards.map((card) => card.id))
  }, [state.status, state.index, state.cards])

  const showNext = useCallback(() => {
    dispatch({ type: "next" })
  }, [])

  const showPrevious = useCallback(() => {
    dispatch({ type: "prev" })
  }, [])

  const retry = useCallback(() => {
    dispatch({ type: "retry" })
    setReload((current) => current + 1)
  }, [])

  return { ...state, showNext, showPrevious, retry }
}
