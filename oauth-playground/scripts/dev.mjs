import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

// Build first, then own the executable directly: stopping the development
// launcher must not leave a cargo-owned API process running on Windows.
export function runDevelopment({ spawnChild = spawn, run = spawnSync } = {}) {
  const options = { cwd: root, stdio: 'inherit', windowsHide: true, shell: false }
  const metadata = run('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', 'backend/Cargo.toml'],
    { ...options, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (metadata.status !== 0) throw new Error('Cannot resolve the local OAuth API Cargo project')
  const target = JSON.parse(metadata.stdout).target_directory
  const compiled = run('cargo', ['build', '--locked', '--manifest-path', 'backend/Cargo.toml'], options)
  if (compiled.status !== 0) throw new Error('OAuth API build failed')
  const executable = path.join(target, 'debug', `oauth-playground-api${process.platform === 'win32' ? '.exe' : ''}`)
  const children = [spawnChild(executable, [], options)]
  children.push(spawnChild(process.execPath, [path.join(root, 'frontend/scripts/dev.mjs')],
    { ...options, cwd: path.join(root, 'frontend') }))
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  }
  const completed = Promise.all(children.map(child => new Promise(resolve => {
    child.once('error', () => { process.exitCode = 1; stop(); resolve(1) })
    child.once('exit', code => { if (!stopping && code !== 0) process.exitCode = 1; stop(); resolve(code) })
  })))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return completed.finally(() => {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runDevelopment() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
