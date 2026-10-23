import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { before, after, test } from 'node:test'
import { preview } from 'vite'
import { Window } from 'happy-dom'
import { buildFixture, deferred, entryFiles, json, platformProps, publicConfig, root, sandbox } from './qiankun-fixture.mjs'

let build
before(async () => { build = await buildFixture() })
after(async () => { await build?.close() })

function assertFlowRequests(requests) {
  for (const request of requests) {
    assert.equal(request.credentials, 'same-origin', 'Rust flow API uses its own same-origin session cookie')
    assert.equal(request.redirect, 'error')
    assert.equal(request.cache, 'no-store')
    assert.equal(request.headers.has('Authorization'), false, 'platform Bearer must never reach OAuth flow API')
    assert.equal(JSON.stringify({ url: request.url, body: request.body, headers: [...request.headers] }).includes('sentinel-platform-bearer'), false)
  }
}

test('qiankun build emits relative classic scripts, scoped CSS and real HTTP assets with 404s', async () => {
  const entry = await entryFiles(build.outDir)
  assert.ok(entry.scripts.length > 0)
  assert.doesNotMatch(entry.html, /<script\b[^>]*type=["']module["']/i)
  assert.ok(entry.styles.length > 0)
  const window = new Window()
  try {
    let selectors = 0
    function checkRules(rules) {
      for (const rule of rules) {
        if (typeof rule.selectorText === 'string') {
          for (const selector of rule.selectorText.split(',')) {
            assert.ok(selector.trim().startsWith('.oauth-playground'), `CSS must be scoped: ${selector}`); selectors++
          }
        } else if (rule.cssRules) checkRules(rule.cssRules)
      }
    }
    for (const src of entry.styles) {
      const stylesheet = new window.CSSStyleSheet()
      stylesheet.replaceSync(await readFile(path.join(build.outDir, src), 'utf8'))
      checkRules(stylesheet.cssRules)
    }
    assert.ok(selectors > 0)
  } finally { await window.happyDOM.close() }
  const prefix = '/sub-apps/oauth-playground/versions/regression/'
  const server = await preview({ configFile: path.join(root, 'vite.config.mjs'), base: prefix, build: { outDir: build.outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  try {
    const base = `http://127.0.0.1:${server.httpServer.address().port}${prefix}`
    assert.equal((await fetch(new URL('index.html', base))).status, 200)
    for (const src of [...entry.scripts.map(script => script.src), ...entry.styles]) {
      assert.ok(!src.startsWith('/') && !src.includes('://'), 'resources remain relative to the version entry')
      const response = await fetch(new URL(src, base))
      assert.equal(response.status, 200, src)
      assert.match(response.headers.get('content-type'), src.endsWith('.css') ? /css/ : /javascript/)
    }
    for (const missing of ['missing.js', 'missing.css', 'missing.png', 'missing.html', 'missing-route']) {
      const response = await fetch(new URL(missing, base), { headers: { Accept: 'text/html' } })
      assert.equal(response.status, 404, `${missing} must not fall back to the application entry`)
    }
  } finally {
    server.httpServer.closeAllConnections()
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
})

test('qiankun actual UMD mounts locally; only config GET occurs until a user action', async t => {
  const s = await sandbox(build.outDir, { fetchImpl: request => request.method === 'POST'
    ? json({ granted: true, tokenType: 'Bearer', expiresIn: 300, scope: 'profile', access_token: 'sentinel-oauth-token' }) : json(publicConfig) })
  t.after(() => s.close())
  assert.ok(s.lifecycle)
  for (const name of ['bootstrap', 'mount', 'update', 'unmount']) assert.equal(typeof s.lifecycle[name], 'function')
  assert.equal(s.requests.length, 0, 'evaluating the HTML entry must not start OAuth requests')
  await s.lifecycle.bootstrap()
  assert.equal(s.requests.length, 0)
  const platform = platformProps()
  await s.lifecycle.mount({ container: s.container, platform })
  await s.flush()
  assert.deepEqual(s.requests.map(request => [request.method || 'GET', request.url]), [['GET', '/oauth-playground-api/config']])
  assert.ok(s.query('#oauth-playground-root').classList.contains('oauth-playground'))
  s.query('[data-testid="flow-client_credentials"]').click()
  await s.flush()
  assert.equal(s.requests.length, 1, 'changing the selected flow does not issue a token')
  s.query('[data-testid="issue-client_credentials"]').click()
  await s.flush()
  assert.equal(s.requests[1].url, '/oauth-playground-api/cc-token')
  assert.equal(s.requests[1].method, 'POST')
  assert.equal(s.query('[data-testid="response-json"]').textContent.includes('sentinel-oauth-token'), false)
  assertFlowRequests(s.requests)
  assert.equal(s.window.document.querySelector('#host').innerHTML, s.hostMarkup)
  assert.equal(s.window.location.href, s.initialHref)
  assert.deepEqual(s.historyCalls, [])
  assert.equal(s.window['oauth-playground'], undefined, 'UMD export remains on the proxy window')
})

test('qiankun passes a configured same-origin OAuth service prefix without forwarding the platform token', async t => {
  const s = await sandbox(build.outDir)
  t.after(() => s.close())
  await s.lifecycle.mount({ container: s.container, platform: platformProps(), services: { oauthApiBase: '/integration/oauth' } })
  await s.flush()
  assert.equal(s.requests[0].url, '/integration/oauth/config')
  assertFlowRequests(s.requests)
})

test('qiankun refuses missing or incompatible platform context before calling the flow API', async t => {
  const s = await sandbox(build.outDir)
  t.after(() => s.close())
  for (const platform of [undefined, platformProps({ sdkVersion: '1.0.0' }), platformProps({ contractVersion: '1.0' })]) {
    await assert.rejects(async () => s.lifecycle.mount({ container: s.container, platform }))
  }
  assert.equal(s.requests.length, 0)
  assert.equal(s.window.document.querySelector('#host').innerHTML, s.hostMarkup)
  assert.equal(s.window.location.href, s.initialHref)
})

test('qiankun authorization changes cancel work and clear sensitive UI before a late response', async t => {
  const waiting = deferred()
  const s = await sandbox(build.outDir, { fetchImpl: request => request.method === 'POST' ? waiting.promise : json(publicConfig) })
  t.after(() => s.close())
  const platform = platformProps()
  await s.lifecycle.mount({ container: s.container, platform })
  await s.flush()
  s.query('[data-testid="flow-password"]').click()
  s.query('[data-testid="username"]').value = 'sensitive-username'
  s.query('[data-testid="password"]').value = 'sensitive-password'
  s.query('#password-form').dispatchEvent(new s.window.Event('submit', { bubbles: true, cancelable: true }))
  await s.flush()
  const request = s.requests.find(request => request.method === 'POST')
  assert.ok(request)
  await s.lifecycle.update({ platform: { ...platform, contextEpoch: 2, contextVersion: 'context-b', organization: { id: 'org-b', name: 'Organization B', path: '/b' }, token: 'replacement-platform-token' } })
  await s.flush()
  assert.equal(request.signal.aborted, true)
  assert.equal(s.query('[data-testid="password"]').value, '')
  assert.equal(s.query('[data-testid="username"]').value, '')
  waiting.resolve(json({ granted: true, scope: 'stale-authorized-scope', access_token: 'sentinel-oauth-token' }))
  await s.flush()
  assert.equal(s.container.textContent.includes('stale-authorized-scope'), false)
  assert.equal(s.container.textContent.includes('sentinel-oauth-token'), false)
  assertFlowRequests(s.requests)
})

test('qiankun cancels device polling and removes listeners and timers on update and unmount', async t => {
  const polling = deferred()
  const s = await sandbox(build.outDir, { fetchImpl: request => {
    if (request.url.endsWith('/device-start')) return json({ user_code: 'PUBLIC-USER-CODE', verification_uri: 'https://platform.test/device', interval: 5, expires_in: 60 })
    if (request.url.endsWith('/device-token')) return polling.promise
    return json(publicConfig)
  } })
  t.after(() => s.close())
  const platform = platformProps()
  await s.lifecycle.mount({ container: s.container, platform }); await s.flush()
  s.query('[data-testid="flow-device"]').click()
  s.query('[data-testid="start-device"]').click(); await s.flush()
  assert.equal(s.query('[data-testid="device-user-code"]').textContent, 'PUBLIC-USER-CODE')
  assert.ok(s.tasks.size > 0)
  await s.advance(5000)
  const request = s.requests.find(request => request.url.endsWith('/device-token'))
  assert.ok(request)
  await s.lifecycle.update({ platform: { ...platform, contextEpoch: 2, token: 'replacement-platform-token' } }); await s.flush()
  assert.equal(request.signal.aborted, true)
  assert.equal(s.container.textContent.includes('PUBLIC-USER-CODE'), false)
  polling.resolve(json({ granted: true, scope: 'stale-device-scope' })); await s.flush()
  assert.equal(s.container.textContent.includes('stale-device-scope'), false)
  const pollingCount = s.requests.filter(request => request.url.endsWith('/device-token')).length
  await s.advance(6000)
  assert.equal(s.requests.filter(request => request.url.endsWith('/device-token')).length, pollingCount)
  const oldButton = s.query('[data-testid="start-device"]'), requestCount = s.requests.length
  await s.lifecycle.unmount()
  oldButton.click(); await s.flush(); await s.advance(60000)
  assert.equal(s.requests.length, requestCount, 'detached controls cannot issue requests after unmount')
  assert.equal(s.tasks.size, 0); assert.equal(s.listeners.size, 0)
  assert.ok(!s.query('#oauth-playground-root') || s.query('#oauth-playground-root').innerHTML === '')
  assert.equal(s.window.document.querySelector('#host').innerHTML, s.hostMarkup)
  assert.equal(s.window.location.href, s.initialHref); assert.deepEqual(s.historyCalls, [])
})

test('callback delivery waits for explicit confirmation before the confidential exchange', async t => {
  const s = await sandbox(build.outDir, { file: 'callback.html', url: 'https://platform.test/callback?code=callback-code&state=callback-state', fetchImpl: request => json(request.method === 'POST' ? { granted: true } : publicConfig) })
  t.after(() => s.close())
  await s.flush()
  assert.equal(s.requests.filter(request => request.method === 'POST').length, 0)
  const button = s.query('[data-testid="complete-callback"]')
  assert.ok(button)
  button.click(); await s.flush()
  const requests = s.requests.filter(request => request.method === 'POST')
  assert.equal(requests.length, 1)
  assert.ok(requests[0].url.endsWith('/callback'))
  assert.deepEqual(JSON.parse(requests[0].body), { state: 'callback-state', code: 'callback-code' })
  assertFlowRequests(s.requests)
})

test('invalid updates revoke pending work and sensitive UI; fresh context can recover only before unmount', async t => {
  const waiting = deferred()
  const s = await sandbox(build.outDir, { fetchImpl: request => request.method === 'POST' ? waiting.promise : json(publicConfig) })
  t.after(() => s.close())
  const platform = platformProps()
  await s.lifecycle.mount({ container: s.container, platform }); await s.flush()
  s.query('[data-testid="flow-client_credentials"]').click()
  s.query('[data-testid="issue-client_credentials"]').click(); await s.flush()
  const request = s.requests.find(request => request.method === 'POST')
  await assert.rejects(s.lifecycle.update({ platform: { ...platform, sdkVersion: '1.0.0' } }))
  assert.equal(request.signal.aborted, true)
  assert.equal(s.container.textContent.trim(), '')
  assert.equal(s.tasks.size, 0)
  waiting.resolve(json({ granted: true, scope: 'late-private-result' })); await s.flush()
  assert.equal(s.container.textContent.includes('late-private-result'), false)
  await s.lifecycle.update({ platform: platformProps({ contextEpoch: 2 }) }); await s.flush()
  assert.ok(s.query('[data-testid="flow-device"]'))
  await assert.rejects(s.lifecycle.update({ platform: undefined }))
  assert.equal(s.container.textContent.trim(), '')
  await s.lifecycle.unmount()
  const count = s.requests.length
  await s.lifecycle.update({ platform: platformProps({ contextEpoch: 3 }) }); await s.flush()
  assert.equal(s.requests.length, count)
})

test('context and token expiry revoke the OAuth UI without waiting for a host update', async t => {
  for (const field of ['expiresAt', 'tokenExpiresAt']) {
    const s = await sandbox(build.outDir)
    t.after(() => s.close())
    await s.lifecycle.mount({ container: s.container, platform: platformProps({ [field]: new Date(s.now() + 1000).toISOString() }) })
    await s.flush()
    assert.ok(s.query('[data-testid="flow-device"]'))
    await s.advance(1001)
    assert.equal(s.container.textContent.trim(), '')
    assert.equal(s.tasks.size, 0)
  }
})
