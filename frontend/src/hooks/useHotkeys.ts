import { useEffect, useEffectEvent } from "react"

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.isContentEditable
}

function isThemeArrow(event: KeyboardEvent) {
  if (!(event.target instanceof Element)) return false
  if (!event.target.closest("[role=radiogroup]")) return false
  return event.code === "ArrowLeft" || event.code === "ArrowRight" || event.code === "ArrowUp" || event.code === "ArrowDown"
}

export function useHotkeys(enabled: boolean, onNext: () => void, onPrevious: () => void) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (event.target instanceof Element && event.target.closest("button") && event.code === "Space") return
    if (isThemeArrow(event)) return
    if (!enabled) return

    if (event.code === "Space" || event.code === "ArrowRight" || event.code === "KeyJ") {
      event.preventDefault()
      onNext()
      return
    }
    if (event.code === "ArrowLeft" || event.code === "KeyK") {
      event.preventDefault()
      onPrevious()
    }
  })

  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
