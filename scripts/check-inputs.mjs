import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url)
const lock = JSON.parse(readFileSync(new URL('dependencies.lock.json', root)))

function assertPath(file) {
  if (typeof file !== 'string' || !file || file.startsWith('/') || /[\\:?#%]/.test(file) ||
      file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe dependency path: ${file}`)
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

if (lock.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(lock.sdkVersion) ||
    !/^[0-9a-f]{40}$/.test(lock.baseCommit) || typeof lock.workingTree !== 'boolean' ||
    lock.source !== `saas-micro-app-sdk/releases/${lock.sdkVersion}` || !lock.files) {
  throw new Error('Invalid SDK dependency provenance')
}

const pinned = new Map()
for (const [file, expected] of Object.entries(lock.files)) {
  assertPath(file)
  const bytes = readFileSync(new URL(file, root))
  if (!/^[0-9a-f]{64}$/.test(expected) || digest(bytes) !== expected) {
    throw new Error(`Pinned dependency changed: ${file}`)
  }
  pinned.set(file, bytes)
}

const sources = [...pinned.keys()].filter(file => /(?:^|\/)SOURCE\.json$|\.SOURCE\.json$/.test(file))
if (!sources.length) throw new Error('Missing SDK source metadata')
const described = new Set(sources)
for (const file of sources) {
  const source = JSON.parse(pinned.get(file).toString('utf8'))
  if (source.schemaVersion !== 1 || source.sdkVersion !== lock.sdkVersion ||
      source.baseCommit !== lock.baseCommit || source.workingTree !== lock.workingTree ||
      ![lock.source, `${lock.source}/sdk.js`].includes(source.source) ||
      !Array.isArray(source.files) || !source.files.length) {
    throw new Error(`Invalid SDK source metadata: ${file}`)
  }
  const directory = file.slice(0, file.lastIndexOf('/') + 1)
  for (const entry of source.files) {
    assertPath(entry.path)
    const target = directory + entry.path
    const bytes = pinned.get(target)
    if (!bytes || described.has(target) || bytes.length !== entry.bytes ||
        digest(bytes) !== entry.sha256 || entry.sha256 !== lock.files[target]) {
      throw new Error(`SDK source bytes differ: ${target}`)
    }
    described.add(target)
  }
}
if (described.size !== pinned.size) throw new Error('Pinned SDK files lack source metadata')
console.log(`Verified ${pinned.size} pinned dependency files and ${sources.length} sources; SDK ${lock.sdkVersion}`)
