import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const preloadFonts = [
  'manrope-latin-wght-normal',
  'manrope-cyrillic-wght-normal',
  'fraunces-latin-opsz-normal',
]

function engmarkBuild(): Plugin {
  return {
    name: 'engmark-build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const hrefs: string[] = []
        for (const item of Object.values(ctx.bundle)) {
          if (item.type !== 'asset' || !item.fileName.endsWith('.woff2')) continue
          const named = item as { fileName: string; name?: string; originalFileNames?: string[] }
          const hint = [named.fileName, named.name ?? '', ...(named.originalFileNames ?? [])].join(' ')
          if (preloadFonts.some((part) => hint.includes(part))) hrefs.push(`/${named.fileName}`)
        }
        if (hrefs.length === 0) return html
        const links = hrefs
          .map((href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)
          .join('\n    ')
        return html.replace('</head>', `    ${links}\n  </head>`)
      },
    },
    closeBundle() {
      const assets = resolve('dist/assets')
      if (existsSync(assets)) {
        const emitted = new Map<string, string>()
        for (const name of readdirSync(assets)) {
          if (!name.startsWith('alt-') || !name.endsWith('.css')) continue
          const cssPath = resolve(assets, name)
          const css = readFileSync(cssPath, 'utf8')
          const rewritten = css.replace(/url\(([^)]+)\)/g, (full, raw: string) => {
            const quoted = raw.trim().replace(/^['"]|['"]$/g, '')
            if (!quoted.endsWith('.woff2') || quoted.startsWith('/') || quoted.includes('://')) return full
            const file = resolve('src/fonts', quoted)
            let fileName = emitted.get(file)
            if (!fileName) {
              const data = readFileSync(file)
              const hash = createHash('sha256').update(data).digest('hex').slice(0, 8)
              const stem = basename(file).replace(/\.woff2$/, '')
              fileName = `${stem}-${hash}.woff2`
              writeFileSync(resolve(assets, fileName), data)
              emitted.set(file, fileName)
            }
            return `url("/assets/${fileName}")`
          })
          writeFileSync(cssPath, rewritten)
        }
      }
      const htmlPath = resolve('dist/index.html')
      if (!existsSync(htmlPath)) return
      const html = readFileSync(htmlPath, 'utf8')
      const match = html.match(/<script>([\s\S]*?)<\/script>/)
      if (!match) return
      const hash = createHash('sha256').update(match[1]).digest('base64')
      writeFileSync(resolve('dist/csp.txt'), `sha256-${hash}\n`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const addr = env.HTTP_ADDR || ':5050'
  const target = addr.startsWith('http://') || addr.startsWith('https://')
    ? addr
    : addr.startsWith(':')
      ? `http://127.0.0.1${addr}`
      : `http://${addr}`

  return {
    plugins: [react(), engmarkBuild()],
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      assetsInlineLimit: 0,
      modulePreload: { polyfill: true },
    },
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})
