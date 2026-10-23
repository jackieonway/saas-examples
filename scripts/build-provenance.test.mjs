import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildInputs, verifyBuildProvenance } from './build-provenance.mjs'

test('freshness rejects changed package locks, source and runtime baselines even when emitted JS is unchanged', async t => {
  const parent = await realpath(os.tmpdir())
  const root = await mkdtemp(path.join(parent, 'example-provenance-'))
  t.after(async () => {
    assert.equal(path.dirname(await realpath(root)), parent)
    assert.ok(path.basename(root).startsWith('example-provenance-'))
    await rm(root, { recursive: true })
  })
  const sources = {
    '.node-version': process.versions.node, '.nvmrc': process.versions.node, '.npmrc': 'engine-strict=true',
    'dependencies.lock.json': '{"sdkVersion":"2.0.0"}',
    'scripts/build-provenance.mjs': '// build plugin', 'scripts/build-provenance.d.mts': '// declaration',
    'example/package.json': '{"version":"1.0.1"}', 'example/package-lock.json': '{"version":"1.0.1"}',
    'example/src/app.js': 'export const application = 1', 'example/public/index.html': '<script src="app.js"></script>',
  }
  for (const [file, contents] of Object.entries(sources)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), contents)
  }
  const output = path.join(root, 'example/dist')
  await mkdir(output)
  await assert.rejects(verifyBuildProvenance('example', output, root), /ENOENT/)
  const captured = await buildInputs('example', root)
  await writeFile(path.join(output, 'build-provenance.json'), JSON.stringify({ schemaVersion: 1,
    applicationDirectory: 'example', nodeVersion: process.versions.node, ...captured }))
  await verifyBuildProvenance('example', output, root)
  for (const [file, changed] of [
    ['example/package-lock.json', '{"version":"1.0.2"}'],
    ['example/src/app.js', 'export const application = 2'],
    ['.node-version', '99.0.0'],
  ]) {
    const original = await readFile(path.join(root, file))
    await writeFile(path.join(root, file), changed)
    await assert.rejects(verifyBuildProvenance('example', output, root), /changed|stale/)
    await writeFile(path.join(root, file), original)
  }
  await verifyBuildProvenance('example', output, root)
})
