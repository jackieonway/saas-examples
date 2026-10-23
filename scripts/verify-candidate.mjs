import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applications, repository, filesIn } from './verify-delivery.mjs'
import { verifyBuildProvenance } from './build-provenance.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function verifyCandidate(directory) {
  await import('./check-inputs.mjs')
  const candidate = JSON.parse(await readFile(path.join(directory, 'candidate-manifest.json'), 'utf8'))
  assert.equal(candidate.schemaVersion, 1)
  assert.equal(candidate.dependencyLockSha256, digest(await readFile(path.join(repository, 'dependencies.lock.json'))), 'Candidate dependency lock is stale; rebuild')
  assert.equal(candidate.verifierSha256, digest(await readFile(path.join(repository, 'scripts/verify-delivery.mjs'))), 'Candidate verifier is stale; rebuild')
  assert.equal(candidate.applications.length, applications.length)
  for (const application of applications) {
    const item = candidate.applications.find(value => value.appCode === application.appCode)
    assert.ok(item, `Candidate is missing ${application.appCode}`)
    assert.equal(item.entry, `${application.appCode}/index.html`)
    assert.equal(item.manifest, `${application.appCode}/delivery-manifest.json`)
    const manifest = JSON.parse(await readFile(path.join(directory, item.manifest), 'utf8'))
    assert.ok(manifest.buildProvenance, `${application.appCode}: candidate source/build provenance is missing; rebuild`)
    const payload = path.join(directory, application.appCode)
    const provenance = await verifyBuildProvenance(application.directory, payload)
    assert.deepEqual(manifest.buildProvenance, provenance)
    assert.equal(item.buildInputsSha256, provenance.inputsSha256)
    assert.equal(item.nodeVersion, provenance.nodeVersion)
    const files = (await filesIn(payload)).filter(file => file.path !== 'delivery-manifest.json')
    assert.deepEqual(manifest.files, files, `${application.appCode}: candidate payload bytes differ from the manifest`)
    console.log(`Fresh candidate: ${application.appCode}; Node ${provenance.nodeVersion}, npm ${provenance.npmVersion}, ${files.length} files`)
  }
  return candidate
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/verify-candidate.mjs <candidate-directory>')
  await verifyCandidate(path.resolve(process.argv[2]))
}
