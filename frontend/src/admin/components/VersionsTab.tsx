import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { type AdminApi, type ApiError, describeError } from '../api/admin'
import { newestFirst, versionDiff } from '../history'
import { formatTime } from '../labels'
import type { CardVersion } from '../types'
import { FieldValue } from './FieldValue'

interface Props {
  api: AdminApi
  cardId: number
  lockedReason: string | null
  initialVersion: number | null
  onTake: (version: CardVersion) => void
}

type State = { status: 'loading' } | { status: 'ready'; versions: CardVersion[] } | { status: 'error'; error: ApiError }

export function VersionsTab({ api, cardId, lockedReason, initialVersion, onTake }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<number | null>(initialVersion)
  const initialRef = useRef<HTMLButtonElement | null>(null)
  const ready = state.status === 'ready'

  useEffect(() => {
    const controller = new AbortController()
    void api.cardVersions(cardId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setState({ status: 'ready', versions: newestFirst(result.value.items) })
      else if (result.error.kind !== 'aborted') setState({ status: 'error', error: result.error })
    })
    return () => controller.abort()
  }, [api, cardId, attempt])

  useEffect(() => {
    if (ready) initialRef.current?.focus()
  }, [ready])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  if (state.status === 'loading') {
    return (
      <div className="drawer__state" role="status">
        Загрузка версий…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="drawer__state" role="alert">
        <p>Не удалось загрузить версии: {describeError(state.error)}</p>
        <button type="button" className="btn" onClick={retry}>
          Повторить
        </button>
      </div>
    )
  }

  const { versions } = state
  const current = versions[0]
  return (
    <div className="db">
      <p className="mdesc">Выберите версию, чтобы увидеть, чем она отличается от текущей. Значения из неё можно взять в форму и сохранить как обычную правку.</p>
      <ol className="vlist" aria-label="Версии карточки, новые сверху">
        {versions.map((version) => (
          <VersionRow
            key={version.version}
            version={version}
            current={current}
            open={open === version.version}
            lockedReason={lockedReason}
            buttonRef={version.version === initialVersion ? initialRef : undefined}
            onToggle={() => setOpen(open === version.version ? null : version.version)}
            onTake={() => onTake(version)}
          />
        ))}
      </ol>
    </div>
  )
}

interface RowProps {
  version: CardVersion
  current: CardVersion
  open: boolean
  lockedReason: string | null
  buttonRef?: RefObject<HTMLButtonElement | null>
  onToggle: () => void
  onTake: () => void
}

function VersionRow({ version, current, open, lockedReason, buttonRef, onToggle, onTake }: RowProps) {
  const panelId = useId()
  const isCurrent = version.version === current.version
  const rows = isCurrent ? [] : versionDiff(version, current)
  const n = version.version

  return (
    <li className={open ? 'vrow open' : 'vrow'}>
      <button type="button" className="vrow__head" ref={buttonRef} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <b className="ver">v{n}</b> <span className="vrow__meta">r{version.revision} · {formatTime(version.createdAt)}</span>
        {isCurrent && <span className="tag ok">текущая</span>}
        {version.archived && <span className="tag del">в архиве</span>}
      </button>
      <div id={panelId} className="vrow__body" hidden={!open}>
        {open && isCurrent && <p className="vrow__note">Это текущая версия. Остальные сравниваются с ней.</p>}
        {open && !isCurrent && (
          <>
            {version.archived && <p className="vrow__note">В этой версии карточка была в архиве. Подставляются только значения полей, из архива она не возвращается.</p>}
            {rows.length === 0 ? (
              <p className="vrow__note">Значения полей такие же, как в текущей версии v{current.version}.</p>
            ) : (
              <table className="vdiff">
                <caption className="sr-only">
                  Чем v{n} отличается от текущей версии v{current.version}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Поле</th>
                    <th scope="col">v{n}</th>
                    <th scope="col">Сейчас · v{current.version}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.field}>
                      <th scope="row">{row.label}</th>
                      <td>
                        <FieldValue field={row.field} value={row.then} />
                      </td>
                      <td>
                        <FieldValue field={row.field} value={row.now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="vrow__actions">
              <button type="button" className="btn pri small" onClick={onTake} disabled={lockedReason !== null || rows.length === 0}>
                Взять значения из v{n}
              </button>
              {lockedReason && <span className="hint">{lockedReason}</span>}
            </div>
          </>
        )}
      </div>
    </li>
  )
}
