import { useEffect, useState } from "react"
import { applyTheme, readTheme, type Theme } from "../study/theme"

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return { theme, setTheme }
}
