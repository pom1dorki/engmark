import { memo, useLayoutEffect, useRef, type KeyboardEvent } from "react"
import { themeMeta } from "../icons"
import { themes, type Theme } from "../study/theme"

type Props = {
  theme: Theme
  onChange: (theme: Theme) => void
}

function moveTheme(theme: Theme, direction: number): Theme {
  const current = themes.indexOf(theme)
  return themes[(current + direction + themes.length) % themes.length]
}

export const ThemeSwitch = memo(function ThemeSwitch({ theme, onChange }: Props) {
  const groupRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group?.contains(document.activeElement)) return
    group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [theme])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0
    if (direction === 0) return
    event.preventDefault()
    event.stopPropagation()
    onChange(moveTheme(theme, direction))
  }

  return (
    <div
      ref={groupRef}
      className="theme-switch"
      role="radiogroup"
      aria-label="Тема оформления"
      onKeyDown={onKeyDown}
    >
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
          tabIndex={item === theme ? 0 : -1}
          onClick={() => onChange(item)}
        >
          <svg className="theme-switch__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d={themeMeta[item].icon} />
          </svg>
        </button>
      ))}
    </div>
  )
})
