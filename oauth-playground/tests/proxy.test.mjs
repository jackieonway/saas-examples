import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { preview } = await import(pathToFileURL(require.resolve('vite')))

test('Vite proxy preserves exact development session cookies and Origin while rejecting neighboring route names', async t => {
  const requests = []
  const api = http.createServer((request, response) => {
    request.resume()
    requests.push({ url: request.url, headers: request.headers })
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}')
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { api.closeAllConnections(); api.close(resolve) }))
  const previous = process.env.OAUTH_PLAYGROUND_API_TARGET
  let server
  try {
    process.env.OAUTH_PLAYGROUND_API_TARGET = `http://127.0.0.1:${api.address().port}`
    server = await preview({ configFile: fileURLToPath(new URL('../frontend/vite.config.mjs', import.meta.url)),
      preview: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' })
  } finally {
    if (previous === undefined) delete process.env.OAUTH_PLAYGROUND_API_TARGET
    else process.env.OAUTH_PLAYGROUND_API_TARGET = previous
  }
  t.after(() => new Promise(resolve => { server.httpServer.closeAllConnections(); server.httpServer.close(resolve) }))
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const headers = { Origin: 'http://platform.example.test', Authorization: 'Bearer platform-only-sentinel',
    Cookie: 'platform_session=private; oauth_playground=local-session; __Host-oauth_playground=secure-session; oauth_playground_extra=private' }
  for (const resource of ['/oauth-playground-api/config', '/api/config']) {
    assert.equal((await fetch(origin + resource, { headers })).status, 200)
    assert.equal(requests.at(-1).url, '/api/config')
    assert.equal(requests.at(-1).headers.authorization, undefined)
    assert.equal(requests.at(-1).headers.cookie, 'oauth_playground=local-session; __Host-oauth_playground=secure-session')
    assert.equal(requests.at(-1).headers.origin, headers.Origin)
  }
  const count = requests.length
  for (const resource of ['/oauth-playground-api-escape/config', '/api-escape/config', '/health-escape']) {
    assert.equal((await fetch(origin + resource)).status, 404)
  }
  assert.equal(requests.length, count, 'neighboring path names must never reach the OAuth API')
})
