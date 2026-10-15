import { splitHighlight } from '../editorModel'
import type { CardData } from '../types'
import { PosBadge } from './Badges'

export function CardPreview({ card }: { card: CardData }) {
  const parts = splitHighlight(card.example, card.exampleHighlight)
  return (
    <div className="preview" role="group" aria-label="Предпросмотр">
      <div className="preview__head">
        <span className="pw" lang="en">
          {card.word || 'word'}
        </span>
        <PosBadge pos={card.pos} />
      </div>
      <div className="pt">{card.translation || 'перевод'}</div>
      {(card.ipa || card.pronunciation) && <div className="pi">{[card.ipa, card.pronunciation].filter(Boolean).join(' ')}</div>}
      {card.example && (
        <>
          <div className="pe" lang="en">
            {parts ? (
              <>
                {parts[0]}
                <mark>{parts[1]}</mark>
                {parts[2]}
              </>
            ) : (
              card.example
            )}
          </div>
          {card.exampleTranslation && <div className="pt">{card.exampleTranslation}</div>}
        </>
      )}
    </div>
  )
}
