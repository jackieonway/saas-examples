import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { runDevelopment } from '../scripts/dev.mjs'

test('development launcher owns both local processes and stops the other when one exits', async () => {
  const runs = [], children = []
  const originalCode = process.exitCode
  const completed = runDevelopment({
    run(command, args, options) {
      runs.push({ command, args, options })
      return { status: 0, stdout: JSON.stringify({ target_directory: path.resolve('backend/target') }) }
    },
    spawnChild(command, args, options) {
      const child = new EventEmitter()
      child.exitCode = null
      child.kill = signal => { child.signal = signal; child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)) }
      children.push({ child, command, args, options })
      return child
    },
  })
  try {
    assert.equal(runs[0].command, 'cargo')
    assert.ok(runs[1].args.includes('--locked'))
    assert.ok(children[0].command.endsWith(process.platform === 'win32' ? 'oauth-playground-api.exe' : 'oauth-playground-api'))
    assert.equal(children[1].command, process.execPath)
    assert.equal(children[1].options.shell, false)
    assert.ok(children[1].args[0].endsWith(path.join('oauth-playground', 'frontend', 'scripts', 'dev.mjs')))
    children[0].child.exitCode = 1
    children[0].child.emit('exit', 1)
    await completed
    assert.equal(children[1].child.signal, 'SIGTERM')
    assert.equal(process.exitCode, 1)
  } finally { process.exitCode = originalCode }
})
