interface Props {
  title: string
  text?: string
  isError?: boolean
  onRetry?: () => void
}

export function BootScreen({ title, text, isError, onRetry }: Props) {
  return (
    <main className="admin-boot">
      <div className="admin-boot__logo" aria-hidden="true">
        E
      </div>
      <h1 className="admin-boot__title">{title}</h1>
      {text && (
        <p className="admin-boot__text" role={isError ? 'alert' : 'status'}>
          {text}
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Повторить
        </button>
      )}
    </main>
  )
}
