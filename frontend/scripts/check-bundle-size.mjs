import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const STUDY_BUDGET = 80 * 1024
const ADMIN_BUDGET = 60 * 1024

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const manifestPath = ['.vite/manifest.json', 'manifest.json'].map((name) => join(dist, name)).find(existsSync)
if (!manifestPath) {
  console.error('dist/.vite/manifest.json not found: run `npm run build` first (build.manifest must be true)')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function closure(entry) {
  if (!manifest[entry]) {
    console.error(`${entry} is missing from the manifest: check build.rollupOptions.input`)
    process.exit(1)
  }
  const seen = new Set()
  const stack = [entry]
  while (stack.length > 0) {
    const key = stack.pop()
    if (seen.has(key)) continue
    const chunk = manifest[key]
    if (!chunk) {
      console.error(`manifest has no entry for ${key}`)
      process.exit(1)
    }
    seen.add(key)
    for (const dep of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) stack.push(dep)
  }
  return seen
}

const sizes = new Map()
function gzipSize(key) {
  if (!sizes.has(key)) sizes.set(key, gzipSync(readFileSync(join(dist, manifest[key].file))).length)
  return sizes.get(key)
}

function report(title, keys) {
  let total = 0
  console.log(title)
  for (const key of [...keys].sort()) {
    const size = gzipSize(key)
    total += size
    console.log(`  ${manifest[key].file} ${size}`)
  }
  return total
}

let failed = false

const study = closure('index.html')
const admin = closure('admin.html')

const leaked = [...study].filter((key) => key.startsWith('src/admin/') || (manifest[key].src ?? '').startsWith('src/admin/'))
if (leaked.length > 0) {
  console.error(`study bundle imports admin code: ${leaked.join(', ')}`)
  failed = true
}

const studyTotal = report('study (index.html)', study)
console.log(`study js gzip ${studyTotal} / ${STUDY_BUDGET}`)
if (studyTotal > STUDY_BUDGET) {
  console.error(`study JS gzip ${studyTotal} exceeds ${STUDY_BUDGET}`)
  failed = true
}

const adminOnly = new Set([...admin].filter((key) => !study.has(key)))
const shared = new Set([...admin].filter((key) => study.has(key)))
console.log(`admin shares ${shared.size} chunk(s) with the study page, not counted in the admin budget`)
const adminTotal = report('admin (admin.html, own chunks)', adminOnly)
console.log(`admin js gzip ${adminTotal} / ${ADMIN_BUDGET}`)
if (adminTotal > ADMIN_BUDGET) {
  console.error(`admin JS gzip ${adminTotal} exceeds ${ADMIN_BUDGET}`)
  failed = true
}

if (failed) process.exit(1)
