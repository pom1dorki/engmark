import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const dir = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const files = readdirSync(dir).filter((name) => name.endsWith('.js'))
let total = 0
for (const name of files) {
  const size = gzipSync(readFileSync(join(dir, name))).length
  total += size
  console.log(`${name} ${size}`)
}
const budget = 80 * 1024
console.log(`js gzip ${total} / ${budget}`)
if (total > budget) {
  console.error(`JS gzip ${total} exceeds ${budget}`)
  process.exit(1)
}
