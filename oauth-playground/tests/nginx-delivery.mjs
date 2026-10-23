import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderEdge } from '../deploy/render-edge.mjs'

const nginx = process.env.OAUTH_TEST_NGINX || '/usr/sbin/nginx'
const openssl = process.env.OAUTH_TEST_OPENSSL || '/usr/bin/openssl'
const directory = fileURLToPath(new URL('../', import.meta.url))
const publicOrigin = 'https://oauth.example.test'
const listen = server => new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) })

function request(port, resource, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // This private test creates its own self-signed cert and listener. No global
    // TLS setting changes, production certificates or external hosts are used.
    const req = https.request({ host: '127.0.0.1', port, path: resource, servername: 'oauth.example.test',
      rejectUnauthorized: false, method, headers: { Host: 'oauth.example.test', ...headers }, timeout: 2000 }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('isolated Nginx request timed out')))
    req.end(body)
  })
}

test('real Nginx delivers qiankun and callback assets, rewrites API paths and preserves the session/CSRF boundary', { timeout: 30000 }, async t => {
  const tempBase = await realpath(os.tmpdir())
  const temporary = await mkdtemp(path.join(tempBase, 'oauth-nginx-'))
  const processes = [], reservations = [], requests = []
  const api = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the synthetic JSON request */ }
    requests.push({ url: req.url, headers: req.headers })
    const allowed = req.method !== 'POST' || (req.headers.origin === publicOrigin && req.headers['content-type'] === 'application/json')
    res.writeHead(allowed ? 200 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Set-Cookie': '__Host-oauth_playground=fixture-session; Path=/; Secure; HttpOnly; SameSite=Lax' })
    res.end(JSON.stringify({ status: allowed ? 'ok' : 'origin_rejected' }))
  })
  t.after(async () => {
    for (const child of processes.reverse()) {
      if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) }
    }
    await close(api)
    for (const server of reservations) if (server.listening) await close(server)
    assert.equal(path.dirname(await realpath(temporary)), tempBase)
    assert.ok(path.basename(temporary).startsWith('oauth-nginx-'))
    await rm(temporary, { recursive: true })
  })
  await listen(api)
  const ports = []
  for (let index = 0; index < 3; index++) {
    const server = net.createServer(); reservations.push(server); await listen(server); ports.push(server.address().port)
  }
  const [staticPort, httpPort, httpsPort] = ports
  const certificate = path.join(temporary, 'certificate.pem'), privateKey = path.join(temporary, 'private.key')
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', privateKey, '-out', certificate, '-subj', '/CN=oauth.example.test'], { stdio: 'ignore' })
  const dist = path.join(directory, 'frontend/dist')
  await readFile(path.join(dist, 'index.html')) // Require the current build, never an archived release.
  let staticConfig = await readFile(path.join(directory, 'deploy/static.nginx.conf'), 'utf8')
  staticConfig = staticConfig.replace('listen 8080;', `listen 127.0.0.1:${staticPort};`)
    .replace('root /usr/share/nginx/html;', `root ${dist};`)
    .replace('pid /tmp/nginx.pid;', `pid ${temporary}/static.pid;`)
  let edgeConfig = renderEdge({ publicOrigin, frontend: 'frontend:8080', api: 'api:3011' })
    .replace('listen 8080;', `listen 127.0.0.1:${httpPort};`)
    .replace('listen 8443 ssl;', `listen 127.0.0.1:${httpsPort} ssl;`)
    .replace('/etc/nginx/tls/fullchain.pem', certificate).replace('/etc/nginx/tls/privkey.pem', privateKey)
    .replace('set $oauth_api api:3011;', `set $oauth_api 127.0.0.1:${api.address().port};`)
    .replace('set $oauth_frontend frontend:8080;', `set $oauth_frontend 127.0.0.1:${staticPort};`)
    .replace('pid /tmp/nginx.pid;', `pid ${temporary}/edge.pid;`)
  for (const [name, config] of [['static', staticConfig], ['edge', edgeConfig]]) {
    let local = config.replace('error_log /dev/stderr crit;', `error_log ${temporary}/${name}.error.log crit;`)
    for (const token of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) local = local.replace(`/tmp/${token};`, `${temporary}/${name}-${token};`)
    const filename = path.join(temporary, `${name}.conf`)
    await writeFile(filename, local)
    execFileSync(nginx, ['-t', '-p', temporary, '-c', filename], { stdio: 'pipe' })
    if (name === 'static') await close(reservations[0])
    else { await close(reservations[1]); await close(reservations[2]) }
    const child = spawn(nginx, ['-p', temporary, '-c', filename, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] })
    processes.push(child)
  }
  for (let attempt = 0; ; attempt++) {
    try { if ((await request(httpsPort, '/healthz')).status === 200) break } catch (error) { if (attempt >= 50) throw error }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const entry = await request(httpsPort, '/sub/oauth-playground/index.html')
  assert.equal(entry.status, 200)
  assert.match(entry.body, /oauth-playground\.umd\.js/)
  assert.doesNotMatch(entry.body, /type=["']module/)
  const callback = await request(httpsPort, '/callback?code=synthetic-code&state=synthetic-state')
  assert.equal(callback.status, 200)
  for (const resource of [...callback.body.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])) {
    const response = await request(httpsPort, resource)
    assert.equal(response.status, 200, resource)
    assert.match(response.headers['content-type'], resource.endsWith('.css') ? /text\/css/ : /javascript/)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  for (const resource of ['/sub/oauth-playground/assets/missing.js', '/assets/missing.js', '/unknown', '/oauth-playground-api']) {
    assert.equal((await request(httpsPort, resource)).status, 404, resource)
  }
  const headers = { Origin: publicOrigin, Authorization: 'Bearer platform-only-sentinel',
    Cookie: 'platform_session=platform-only-sentinel; oauth_playground=legacy-only; __Host-oauth_playground=fixture-session',
    'Content-Type': 'application/json' }
  const response = await request(httpsPort, '/oauth-playground-api/callback', { method: 'POST', headers, body: '{}' })
  assert.equal(response.status, 200)
  assert.match(response.headers['set-cookie'][0], /__Host-oauth_playground=fixture-session/)
  assert.equal(requests.at(-1).url, '/api/callback')
  assert.equal(requests.at(-1).headers.authorization, undefined)
  assert.equal(requests.at(-1).headers.cookie, '__Host-oauth_playground=fixture-session')
  assert.equal(requests.at(-1).headers.origin, publicOrigin)
  for (const origin of [undefined, 'https://attacker.example.test']) {
    const badHeaders = { ...headers }; delete badHeaders.Origin
    if (origin) badHeaders.Origin = origin
    assert.equal((await request(httpsPort, '/oauth-playground-api/callback', { method: 'POST', headers: badHeaders, body: '{}' })).status, 403)
    assert.equal(requests.at(-1).headers.origin, origin)
  }
  assert.equal((await request(httpsPort, '/api/config', { headers })).status, 200)
  assert.equal(requests.at(-1).url, '/api/config')
  assert.equal((await request(httpsPort, '/oauth-playground-api/config', {
    headers: { Cookie: 'platform_session=private; oauth_playground=legacy-only', Authorization: 'Bearer platform-only-sentinel' },
  })).status, 200)
  assert.equal(requests.at(-1).headers.cookie, undefined, 'HTTPS production does not forward an insecure development cookie')
  assert.equal(requests.at(-1).headers.authorization, undefined)
})
