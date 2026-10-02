// First paint uses the same list and colors in index.html, before this module loads.

export const themes = ["dark", "light", "sepia", "alt-dark"] as const
export type Theme = (typeof themes)[number]

const themeColors: Record<Theme, string> = {
  dark: "#07070a",
  light: "#f4f3ef",
  sepia: "#f0dfbd",
  "alt-dark": "#050507",
}

const storageKey = "ew-theme"

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey)
    return themes.includes(saved as Theme) ? (saved as Theme) : "dark"
  } catch {
    return "dark"
  }
}

export function applyTheme(theme: Theme) {
  const isAlt = theme.startsWith("alt-")
  const isLight = theme === "light" || theme === "sepia"
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.themeFamily = isAlt ? "alt" : "default"
  root.style.colorScheme = isLight ? "light" : "dark"
  const altFonts = document.getElementById("fonts-alt")
  if (altFonts instanceof HTMLLinkElement) altFonts.media = isAlt ? "all" : "not all"
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme])
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Theme still applies for this visit.
  }
}
