import assert from 'node:assert/strict'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const digest = value => createHash('sha256').update(value).digest('hex')
const sharedInputs = ['.node-version', '.nvmrc', '.npmrc', 'dependencies.lock.json',
  'scripts/build-provenance.mjs', 'scripts/build-provenance.d.mts']
const sourceDirectories = new Set(['src', 'public', 'vendor', 'scripts'])
const rootInput = name => /^(?:package(?:-lock)?\.json|vite\.config\.[cm]?[jt]s|tsconfig(?:\.[^.]+)?\.json|index\.html|frontend\.tsx)$/.test(name)

export async function buildInputs(applicationDirectory, root = repository) {
  assert.ok(!applicationDirectory.includes('..') && !path.isAbsolute(applicationDirectory), 'Use a repository-relative application directory')
  const files = [...sharedInputs]
  async function walk(directory) {
    for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${item.name}`
      assert.ok(!(await lstat(path.join(root, relative))).isSymbolicLink(), `Build inputs cannot contain a symlink: ${relative}`)
      if (item.isDirectory()) await walk(relative)
      else files.push(relative)
    }
  }
  for (const item of await readdir(path.join(root, applicationDirectory), { withFileTypes: true })) {
    if (item.isDirectory() && sourceDirectories.has(item.name)) await walk(`${applicationDirectory}/${item.name}`)
    else if (item.isFile() && rootInput(item.name)) files.push(`${applicationDirectory}/${item.name}`)
  }
  const inputs = []
  for (const relative of files.sort()) {
    const bytes = await readFile(path.join(root, relative))
    inputs.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) })
  }
  return { inputs, inputsSha256: digest(JSON.stringify(inputs)),
    nodeBaseline: (await readFile(path.join(root, '.node-version'), 'utf8')).trim() }
}

export function buildProvenance(applicationDirectory, { publicConfig = {} } = {}) {
  let initial
  return {
    name: 'qiankun-build-provenance', apply: 'build',
    async buildStart() {
      initial = await buildInputs(applicationDirectory)
      assert.equal(process.versions.node, initial.nodeBaseline, `Build with Node ${initial.nodeBaseline}`)
    },
    async generateBundle() {
      const current = await buildInputs(applicationDirectory)
      assert.equal(current.inputsSha256, initial.inputsSha256, 'Build inputs changed while Vite was running; rebuild before packaging')
      this.emitFile({ type: 'asset', fileName: 'build-provenance.json', source: JSON.stringify({
        schemaVersion: 1, applicationDirectory, builtAt: new Date().toISOString(), nodeVersion: process.versions.node,
        npmVersion: process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1] || null,
        publicConfig, ...initial,
      }, null, 2) + '\n' })
    },
  }
}

export async function verifyBuildProvenance(applicationDirectory, directory, root = repository) {
  const provenance = JSON.parse(await readFile(path.join(directory, 'build-provenance.json'), 'utf8'))
  assert.equal(provenance.schemaVersion, 1)
  assert.equal(provenance.applicationDirectory, applicationDirectory)
  const current = await buildInputs(applicationDirectory, root)
  assert.equal(provenance.nodeVersion, current.nodeBaseline, `${applicationDirectory}: stale build runtime; rebuild with Node ${current.nodeBaseline}`)
  assert.equal(provenance.inputsSha256, current.inputsSha256, `${applicationDirectory}: source/build inputs changed; rebuild`)
  assert.deepEqual(provenance.inputs, current.inputs, `${applicationDirectory}: build input manifest changed; rebuild`)
  return provenance
}
