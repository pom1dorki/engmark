import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { themes } from "./theme"

const themeColors: Record<(typeof themes)[number], string> = {
  dark: "#07070a",
  light: "#f4f3ef",
  sepia: "#f0dfbd",
  "alt-dark": "#050507",
}

function inlineScript(html: string) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error("inline theme script is missing")
  return match[1]
}

describe("theme boot script", () => {
  const html = readFileSync(resolve("index.html"), "utf8")
  const script = inlineScript(html)

  it("lists the same themes and colors as theme.ts", () => {
    const listed = script.match(/var themes = (\[[^\]]+\]);/)
    expect(listed?.[1] && JSON.parse(listed[1].replace(/'/g, '"'))).toEqual([...themes])
    for (const theme of themes) {
      expect(script).toContain(`"${themeColors[theme]}"`)
    }
  })

  it("matches the CSP hash in the Caddyfile", () => {
    const hash = createHash("sha256").update(script).digest("base64")
    const caddy = readFileSync(resolve("../Caddyfile"), "utf8")
    expect(caddy).toContain(`'sha256-${hash}'`)
    expect(caddy).toContain("max-age=300")
  })
})
