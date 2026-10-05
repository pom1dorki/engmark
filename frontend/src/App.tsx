import { useCallback } from "react"
import { StatusCard } from "./components/StatusCard"
import { ThemeSwitch } from "./components/ThemeSwitch"
import { WordCard } from "./components/WordCard"
import { useDeck } from "./hooks/useDeck"
import { useHotkeys } from "./hooks/useHotkeys"
import { useSpeech } from "./hooks/useSpeech"
import { useTheme } from "./hooks/useTheme"

export default function App() {
  const { status, cards, index, showNext, showPrevious, retry } = useDeck()
  const { theme, setTheme } = useTheme()
  const { speechOn, speaking, speechLive, pronounce, halt } = useSpeech()

  const onNext = useCallback(() => {
    halt()
    showNext()
  }, [halt, showNext])

  const onPrevious = useCallback(() => {
    halt()
    showPrevious()
  }, [halt, showPrevious])

  const ready = status === "ready"
  useHotkeys(ready && cards.length > 0, onNext, onPrevious)

  const card = cards[index]
  const shown = ready && Boolean(card)
  const live = speechLive || (shown && card
    ? `${card.word}. ${card.translation}. Карточка ${index + 1} из ${cards.length}`
    : status === "empty"
      ? "Словарь пуст"
      : status === "error"
        ? "Не удалось загрузить словарь"
        : "")
  const counter = shown ? index + 1 : 0
  const total = shown ? cards.length : 0

  return (
    <div className="page">
      <main className="page__main">
        <header className="page__header">
          <h1 className="page__title">Английские слова</h1>
          <div className="page__toolbar">
            <ThemeSwitch theme={theme} onChange={setTheme} />
            <p className="page__counter" aria-label={`Карточка ${counter} из ${total}`}>
              <span>{counter}</span> / <span>{total}</span>
            </p>
          </div>
        </header>

        <article className={shown ? "card is-fade" : "card is-empty"} key={shown && card ? `${card.id}-${index}` : status}>
          {!shown && status !== "ready" && <StatusCard status={status} onRetry={retry} />}
          {shown && card && (
            <WordCard
              card={card}
              speaking={speaking}
              speechOn={speechOn}
              onSpeak={pronounce}
              onNext={onNext}
            />
          )}
        </article>
        <p className="visually-hidden" role="status" aria-live="polite">{live}</p>
      </main>
    </div>
  )
}
