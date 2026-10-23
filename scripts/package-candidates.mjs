import { mkdir, cp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { applications, repository, verifyDelivery } from './verify-delivery.mjs'

await import('./check-inputs.mjs')
const name = process.argv[2] || `qiankun-${new Date().toISOString().replaceAll(/[-:.]/g, '')}`
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) || name.includes('..')) throw new Error('Use a new simple candidate directory name')
const manifests = await verifyDelivery()
const parent = path.join(repository, 'artifacts/candidates')
await mkdir(parent, { recursive: true })
const output = path.join(parent, name)
await mkdir(output) // Never overwrite an existing candidate or historical artifact.
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim()
const workingTree = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim()
for (const [index, application] of applications.entries()) {
  await cp(path.join(repository, application.directory, 'dist'), path.join(output, application.appCode), { recursive: true, errorOnExist: true, force: false })
  await writeFile(path.join(output, application.appCode, 'delivery-manifest.json'), JSON.stringify(manifests[index], null, 2) + '\n', { flag: 'wx' })
}
const lock = await readFile(path.join(repository, 'dependencies.lock.json'))
const verifier = await readFile(path.join(repository, 'scripts/verify-delivery.mjs'))
await writeFile(path.join(output, 'candidate-manifest.json'), JSON.stringify({ schemaVersion: 1, candidate: name,
  createdAt: new Date().toISOString(), sourceRevision, workingTree, dependencyLockSha256: createHash('sha256').update(lock).digest('hex'),
  verifierSha256: createHash('sha256').update(verifier).digest('hex'),
  applications: manifests.map(manifest => ({ appCode: manifest.appCode, entry: `${manifest.appCode}/index.html`, manifest: `${manifest.appCode}/delivery-manifest.json`,
    nodeVersion: manifest.buildProvenance.nodeVersion, buildInputsSha256: manifest.buildProvenance.inputsSha256 })),
}, null, 2) + '\n', { flag: 'wx' })
console.log(`Local candidates: ${output}`)
