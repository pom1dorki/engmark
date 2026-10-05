import type { DeckStatus } from "../hooks/useDeck"

type Props = {
  status: Exclude<DeckStatus, "ready">
  onRetry: () => void
}

export function StatusCard({ status, onRetry }: Props) {
  return (
    <>
      <p className="card__empty">
        {status === "loading" && "Загрузка…"}
        {status === "error" && "Не удалось загрузить словарь"}
        {status === "empty" && "Словарь пуст."}
      </p>
      {status === "error" && (
        <button className="card__next card__next--plain card__retry" type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </>
  )
}
