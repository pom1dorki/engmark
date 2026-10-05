import { memo, useMemo } from "react"
import type { Card } from "../api/cards"
import { highlightExample } from "../study/highlight"

type Props = {
  card: Card
  speaking: boolean
  speechOn: boolean
  onSpeak: (word: string) => void
  onNext: () => void
}

export const WordCard = memo(function WordCard({ card, speaking, speechOn, onSpeak, onNext }: Props) {
  const example = useMemo(
    () => highlightExample(card.example, card.exampleHighlight),
    [card.example, card.exampleHighlight],
  )

  return (
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
          title={speechOn ? "Произнести слово" : "Озвучка не поддерживается браузером"}
          aria-label="Произнести слово"
          aria-busy={speaking}
          disabled={!speechOn}
          onClick={() => onSpeak(card.word)}
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
          <p className="card__example" lang="en">{example}</p>
          <p className="card__example-ru">{card.exampleTranslation}</p>
        </section>
      </div>

      <div className="card__actions">
        <button className="card__next" type="button" onClick={onNext}>Другое слово</button>
      </div>
    </>
  )
})
