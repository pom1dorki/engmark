import "./App.css"
import { useCallback, useEffect, useState } from "react"
import { listCards, type Card } from "./api/cards"
import { highlightExample } from "./study/highlight"
import { restoreDeck, saveProgress, stepBack, stepForward } from "./study/order"
import { canSpeak, initVoices, speakWord, stopSpeaking } from "./study/speak"
import { applyTheme, readTheme, themes, type Theme } from "./study/theme"

type Status = "loading" | "ready" | "empty" | "error"

const themeMeta: Record<Theme, { label: string; title: string; icon: string }> = {
  dark: {
    label: "Тёмная тема",
    title: "Тёмная",
    icon: "M17.3 15.2A7.5 7.5 0 0 1 9.1 5.4 7.5 7.5 0 1 0 17.3 15.2z",
  },
  light: {
    label: "Светлая тема",
    title: "Светлая",
    icon: "M12 4.2a1 1 0 0 0 1-1V2a1 1 0 1 0-2 0v1.2a1 1 0 0 0 1 1zm0 15.6a1 1 0 0 0-1 1V22a1 1 0 1 0 2 0v-1.2a1 1 0 0 0-1-1zM6.05 6.05a1 1 0 0 0 0-1.41L5.2 3.8A1 1 0 0 0 3.8 5.2l.84.84a1 1 0 0 0 1.41 0zm11.9 11.9a1 1 0 0 0 0 1.41l.84.84A1 1 0 1 0 20.2 18.8l-.84-.84a1 1 0 0 0-1.41 0zM4.2 12a1 1 0 0 0-1-1H2a1 1 0 1 0 0 2h1.2a1 1 0 0 0 1-1zm17.8-1h-1.2a1 1 0 1 0 0 2H22a1 1 0 1 0 0-2zM6.05 17.95a1 1 0 0 0-1.41 0l-.84.84A1 1 0 1 0 5.2 20.2l.84-.84a1 1 0 0 0 0-1.41zm12.74-12.74a1 1 0 0 0 1.41 0l.84-.84A1 1 0 0 0 18.8 3.8l-.84.84a1 1 0 0 0 0 1.41zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  },
  sepia: {
    label: "Сепия",
    title: "Сепия",
    icon: "M6 4h12a1 1 0 0 1 1 1v15.2a.8.8 0 0 1-1.22.68L12 17.4l-5.78 3.48A.8.8 0 0 1 5 20.2V5a1 1 0 0 1 1-1zm2 4v2h8V8H8zm0 4v2h6v-2H8z",
  },
  "alt-dark": {
    label: "Альтернативная тёмная",
    title: "Альт. тёмная",
    icon: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 2.2 2.1-2.2H20v7h-7v-4.8z",
  },
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.isContentEditable
}

export default function App() {
  const [cards, setCards] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<Status>("loading")
  const [reload, setReload] = useState(0)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const speechOn = canSpeak()
  const [speaking, setSpeaking] = useState(false)
  const [speechLive, setSpeechLive] = useState("")

  const haltSpeech = useCallback(() => {
    stopSpeaking()
    setSpeaking(false)
    setSpeechLive("")
  }, [])

  const showNext = useCallback(() => {
    haltSpeech()
    const next = stepForward(cards, index)
    setCards(next.items)
    setIndex(next.index)
  }, [cards, haltSpeech, index])

  const showPrevious = useCallback(() => {
    haltSpeech()
    setIndex(stepBack(cards, index))
  }, [cards, haltSpeech, index])

  useEffect(() => {
    initVoices()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    listCards(controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return
        if (list.items.length === 0) {
          setCards([])
          setIndex(0)
          setStatus("empty")
          return
        }
        const deck = restoreDeck(list.items)
        setCards(deck.items)
        setIndex(deck.index)
        setStatus("ready")
      },
      (err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return
        setCards([])
        setStatus("error")
      },
    )
    return () => {
      controller.abort()
    }
  }, [reload])

  useEffect(() => {
    if (status !== "ready") return
    saveProgress(index, cards.map((card) => card.id))
  }, [status, index, cards])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    function stop() {
      stopSpeaking()
      setSpeaking(false)
    }
    function onHide() {
      if (document.visibilityState === "hidden") stop()
    }
    window.addEventListener("pagehide", stop)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      window.removeEventListener("pagehide", stop)
      document.removeEventListener("visibilitychange", onHide)
      stopSpeaking()
    }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.target instanceof Element && event.target.closest("button") && event.code === "Space") return
      if (status !== "ready" || cards.length === 0) return

      if (event.code === "Space" || event.code === "ArrowRight" || event.code === "KeyJ") {
        event.preventDefault()
        showNext()
        return
      }
      if (event.code === "ArrowLeft" || event.code === "KeyK") {
        event.preventDefault()
        showPrevious()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [cards, index, showNext, showPrevious, status])

  function retry() {
    setStatus("loading")
    setReload((current) => current + 1)
  }

  function pronounce(word: string) {
    if (!speechOn) return
    setSpeechLive(`Произносится: ${word}`)
    speakWord(word, (active) => {
      setSpeaking(active)
      if (!active) setSpeechLive("")
    })
  }

  const card = cards[index]
  const ready = status === "ready" && Boolean(card)
  const live = speechLive || (ready && card
    ? `${card.word}. ${card.translation}. Карточка ${index + 1} из ${cards.length}`
    : status === "empty"
      ? "Словарь пуст"
      : status === "error"
        ? "Не удалось загрузить словарь"
        : "")
  const counter = ready ? index + 1 : 0
  const total = ready ? cards.length : 0

  return (
    <div className="page">
      <main className="page__main">
        <header className="page__header">
          <h1 className="page__title">Английские слова</h1>
          <div className="page__toolbar">
            <div className="theme-switch" role="radiogroup" aria-label="Тема оформления">
              {themes.map((item) => (
                <button
                  key={item}
                  className={item === theme ? "theme-switch__btn is-active" : "theme-switch__btn"}
                  type="button"
                  role="radio"
                  data-theme={item}
                  aria-label={themeMeta[item].label}
                  title={themeMeta[item].title}
                  aria-checked={item === theme}
                  onClick={() => setTheme(item)}
                >
                  <svg className="theme-switch__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={themeMeta[item].icon} />
                  </svg>
                </button>
              ))}
            </div>
            <p className="page__counter" aria-label="Номер карточки">
              <span>{counter}</span> / <span>{total}</span>
            </p>
          </div>
        </header>

        <article className={ready ? "card is-fade" : "card is-empty"} key={ready ? `${card.id}-${index}` : status}>
          {!ready && (
            <p className="card__empty">
              {status === "loading" && "Загрузка…"}
              {status === "error" && "Не удалось загрузить словарь"}
              {status === "empty" && "Словарь пуст."}
            </p>
          )}
          {status === "error" && (
            <button className="card__next card__next--plain card__retry" type="button" onClick={retry}>
              Повторить
            </button>
          )}
          {ready && card && (
            <>
              <div className="card__head">
                <div className="card__word-wrap">
                  <div className="card__word-row">
                    <h2 className="card__word" lang="en">{card.word}</h2>
                    <div className="chips">
                      <span className={`chips__item chips__item--${card.pos}`}>{card.posRu}</span>
                    </div>
                  </div>
                  <p className="card__translation">{card.translation}</p>
                </div>
                <button
                  className={speaking ? "card__speak is-speaking" : "card__speak"}
                  type="button"
                  title="Произнести слово"
                  aria-label="Произнести слово"
                  aria-busy={speaking}
                  disabled={!speechOn}
                  onClick={() => pronounce(card.word)}
                >
                  <svg className="card__speak-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 10v4a1 1 0 0 0 1 1h3.2L12 19.4V4.6L7.2 9H4a1 1 0 0 0-1 1zm13.5 2a3.5 3.5 0 0 0-1.8-3.05v6.1A3.5 3.5 0 0 0 16.5 12zm-1.8-7.05v1.62A6.5 6.5 0 0 1 19.5 12a6.5 6.5 0 0 1-4.8 6.28v1.62A8.01 8.01 0 0 0 21.5 12a8.01 8.01 0 0 0-6.8-7.05z" />
                  </svg>
                </button>
              </div>

              <div className="card__grid">
                <section className="card__block">
                  <h3 className="card__label">Транскрипция и ударение</h3>
                  <p className="card__trans">
                    <span className="card__ipa">{card.ipa}</span>
                    <span className="card__rus">{card.pronunciation}</span>
                    <span className="card__stress">{card.stressNote}</span>
                  </p>
                </section>
                <section className="card__block">
                  <h3 className="card__label">Грамматика</h3>
                  <p className="card__text">{card.grammar}</p>
                </section>
                <section className="card__block">
                  <h3 className="card__label">Контекст и стиль</h3>
                  <p className="card__text">{card.usage}</p>
                </section>
                <section className="card__block">
                  <h3 className="card__label">Пример</h3>
                  <p className="card__example" lang="en">{highlightExample(card.example, card.exampleHighlight)}</p>
                  <p className="card__example-ru">{card.exampleTranslation}</p>
                </section>
              </div>

              <div className="card__actions">
                <button className="card__next" type="button" onClick={showNext}>Другое слово</button>
                <p className="card__hint card__hint--keyboard">Пробел, → или J — следующая карточка</p>
                <p className="card__hint card__hint--touch">Нажмите кнопку, чтобы сменить слово</p>
              </div>
            </>
          )}
        </article>
        <p className="visually-hidden" role="status" aria-live="polite">{live}</p>
      </main>
    </div>
  )
}
