import { cpSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_DIR = 'src'
const DIST_DIR = 'dist'

// Non-TypeScript runtime assets that tsc does not emit. Modules load these at
// runtime relative to their compiled output (e.g. PromptLoaderService), so
// they must mirror their src/ location inside dist/.
const files = globSync(join(SRC_DIR, '**/*.txt')).sort()

for (const file of files) {
  const relativePath = relative(SRC_DIR, file)
  cpSync(file, join(DIST_DIR, relativePath), { recursive: true })
  console.log(`  ${relativePath}`)
}

console.log(`Copied ${files.length} assets from ${SRC_DIR}/ to ${DIST_DIR}/`)
