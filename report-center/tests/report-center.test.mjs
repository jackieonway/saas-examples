import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import postcss from 'postcss'
import { JSDOM, VirtualConsole } from 'jsdom'
import { SDK_VERSION } from '../vendor/micro-sdk/index.mjs'

const configFile = fileURLToPath(new URL('../vite.config.mjs', import.meta.url))
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')
let javascript, css
before(async () => {
  await build({ configFile })
  javascript = await read('dist/report-center.umd.js')
  css = await read('dist/report-center.css')
}, { timeout: 120000 })

const pause = () => new Promise(resolve => setTimeout(resolve, 10))
async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) { if (check()) return; await pause() }
  assert.ok(check(), 'React render did not settle')
}

function fixture() {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<main id="host-sentinel">宿主</main><div id="container"><div id="report-center-root"></div></div>', {
    url: 'https://platform.example.test/micro/report-center', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  })
  const { window } = dom
  window.fetch = async () => { throw new Error('Unexpected request') }
  const timers = new Set()
  const setInterval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window)
  window.setInterval = (...args) => { const id = setInterval(...args); timers.add(id); return id }
  window.clearInterval = id => { timers.delete(id); clearInterval(id) }
  window.eval(javascript)
  const lifecycle = window['report-center']
  const calls = []
  const platform = (changes = {}) => ({
    sdkVersion: SDK_VERSION, contractVersion: '2.0', contextVersion: 'context-1', contextEpoch: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    appCode: 'report-center', basePath: '/micro/report-center', routePath: '/micro/report-center',
    token: 'application-token', user: { id: 'user', username: 'alice', displayName: 'Alice' },
    tenant: { id: 'tenant', code: 'tenant', name: '租户' }, organization: { id: 'org', name: '组织一', path: '/org' },
    roles: [{ id: 'role', code: 'reader', name: '读者' }], permissions: [], dataGrants: [], menus: [],
    organizationScopeIds: [], theme: 'light', signal: new window.AbortController().signal,
    onNavigate: path => calls.push(['navigate', path]), onNotify: (...args) => calls.push(['notify', ...args]), ...changes,
  })
  const container = window.document.querySelector('#container')
  return { dom, window, lifecycle, platform, container, calls, errors, timers,
    text: () => container.textContent,
    button: text => [...container.querySelectorAll('button')].find(button => button.textContent.includes(text)),
    close: async () => { await lifecycle.unmount(); dom.window.close() },
  }
}

test('built delivery is classic UMD with only standard qiankun exports and scoped CSS', async () => {
  const html = await read('dist/index.html')
  assert.doesNotMatch(html, /type=["']module|@vite\/client/)
  assert.match(html, /src="\.\/report-center\.umd\.js" entry/)
  assert.match(html, /href="\.\/report-center\.css"/)
  assert.doesNotMatch(javascript, /process\.env\.NODE_ENV|@\/components\/|sonner/)
  postcss.parse(css).walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
    for (const selector of rule.selectors) assert.ok(selector.startsWith('.saas-report-center'), selector)
  })
  assert.doesNotMatch(css, /--tw-/)
  const f = fixture()
  try { assert.deepEqual(Object.keys(f.lifecycle).sort(), ['bootstrap', 'mount', 'unmount', 'update']) }
  finally { await f.close() }
})

test('independent UMD preserves component state across route/theme/context updates and delegates host callbacks', async () => {
  const f = fixture()
  try {
    const context = f.platform({ routePath: '/micro/report-center/shared' })
    await f.lifecycle.bootstrap({})
    await f.lifecycle.mount({ name: 'report-center', container: f.container, platform: context })
    await until(() => f.button('应用按钮'))
    const applicationRoot = f.container.querySelector('.saas-report-center')
    f.button('应用按钮').click()
    await until(() => f.button('应用按钮').textContent.includes('1 次'))
    await f.lifecycle.update({ platform: { ...context, theme: 'dark', contextEpoch: 2, contextVersion: 'context-2' } })
    await until(() => f.container.querySelector('.saas-report-center').dataset.theme === 'dark')
    assert.equal(f.container.querySelector('.saas-report-center'), applicationRoot)
    assert.match(f.button('应用按钮').textContent, /1 次/)
    assert.equal(f.window.document.documentElement.getAttribute('data-theme'), null)
    assert.equal(f.window.document.querySelector('#host-sentinel').textContent, '宿主')
    f.button('props.onNotify · success').click()
    f.button('onNavigate').click()
    assert.equal(f.calls[0][0], 'notify')
    assert.equal(f.calls[0][2], 'success')
    assert.deepEqual(f.calls[1], ['navigate', '/micro/report-center'])
    assert.equal(f.timers.size, 1)
    await f.lifecycle.unmount()
    assert.equal(f.container.querySelector('#report-center-root').textContent, '')
    assert.equal(f.timers.size, 0)
    assert.deepEqual(f.errors, [])
  } finally { await f.close() }
})

test('authorization updates and unmount abort old requests and discard late role responses', async () => {
  const f = fixture()
  try {
    const requests = []
    f.window.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }))
    const first = f.platform()
    await f.lifecycle.mount({ container: f.container, platform: first })
    await until(() => f.button('请求当前用户角色'))
    f.button('请求当前用户角色').click()
    await until(() => requests.length === 1)
    assert.equal(requests[0].url, '/api/external/roles')
    assert.equal(requests[0].options.credentials, 'omit')
    assert.equal(requests[0].options.headers.Authorization, 'Bearer application-token')
    const next = f.platform({ contextEpoch: 2, contextVersion: 'context-2', token: 'next-token',
      organization: { id: 'org-2', name: '组织二', path: '/org-2' } })
    await f.lifecycle.update({ platform: next })
    assert.equal(requests[0].options.signal.aborted, true)
    requests[0].resolve({ ok: true, status: 200, json: async () => ({ organizations: [{ id: 'old', name: '旧组织迟到数据', tenantName: '', roles: [] }] }) })
    await until(() => f.text().includes('组织二'))
    assert.ok(!f.text().includes('旧组织迟到数据'))
    await f.lifecycle.update({ platform: first })
    await pause()
    assert.ok(f.text().includes('组织二'), 'older contextEpoch must not replace the current context')
    f.button('请求当前用户角色').click()
    await until(() => requests.length === 2)
    assert.equal(requests[1].options.headers.Authorization, 'Bearer next-token')
    await f.lifecycle.unmount()
    assert.equal(requests[1].options.signal.aborted, true)
    requests[1].resolve({ ok: true, status: 200, json: async () => ({ organizations: [] }) })
    await pause()
    assert.equal(f.container.querySelector('#report-center-root').textContent, '')
    assert.deepEqual(f.errors, [])
  } finally { await f.close() }
})

test('missing nested authorization, expired credentials and absent scoped root refuse mounting', async () => {
  const f = fixture()
  try {
    await assert.rejects(f.lifecycle.mount({ container: f.container }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ ...f.platform(), container: f.container }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ container: f.container, platform: f.platform({ sdkVersion: '1.0.0' }) }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ container: f.container, platform: f.platform({ contractVersion: '1.0' }) }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ container: f.container, platform: f.platform({ token: 42 }) }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ container: f.container, platform: f.platform({ expiresAt: 'invalid' }) }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ container: f.container, platform: f.platform({ tokenExpiresAt: new Date(0).toISOString() }) }), /props.platform/)
    await assert.rejects(f.lifecycle.mount({ platform: f.platform() }), /container/)
    await assert.rejects(f.lifecycle.mount({ container: f.window.document.querySelector('#host-sentinel'), platform: f.platform() }), /挂载节点/)
    assert.equal(f.timers.size, 0)
    assert.equal(f.container.querySelector('#report-center-root').textContent, '')
  } finally { await f.close() }
})

test('revocation, earliest expiry and invalid updates clear the authorized view and permit fresh nested context', async () => {
  const f = fixture()
  try {
    const source = new f.window.AbortController()
    await f.lifecycle.mount({ container: f.container, platform: f.platform({ signal: source.signal }) })
    await until(() => f.button('请求当前用户角色'))
    source.abort()
    await until(() => f.container.querySelector('#report-center-root').textContent === '')
    assert.equal(f.timers.size, 0)
    const next = f.platform({ contextEpoch: 2, contextVersion: 'context-2' })
    await f.lifecycle.update({ platform: next })
    await until(() => f.button('请求当前用户角色'))
    await assert.rejects(f.lifecycle.update(next), /props.platform/)
    assert.equal(f.container.querySelector('#report-center-root').textContent, '')
    assert.equal(f.timers.size, 0)
    await f.lifecycle.update({ platform: f.platform({ contextEpoch: 3, tokenExpiresAt: new Date(Date.now() + 100).toISOString() }) })
    await until(() => f.button('请求当前用户角色'))
    await until(() => f.container.querySelector('#report-center-root').textContent === '')
    assert.equal(f.timers.size, 0)
    assert.deepEqual(f.errors, [])
  } finally { await f.close() }
})

test('same-epoch permission and data-grant changes discard previously loaded role data', async () => {
  const f = fixture()
  try {
    f.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
      organizations: [{ id: 'sensitive', name: '旧授权角色数据', tenantName: '', roles: [] }],
    }) })
    const context = f.platform()
    await f.lifecycle.mount({ container: f.container, platform: context })
    await until(() => f.button('请求当前用户角色'))
    f.button('请求当前用户角色').click()
    await until(() => f.text().includes('旧授权角色数据'))
    await f.lifecycle.update({ platform: { ...context, permissions: ['report:limited'],
      dataGrants: [{ resource: 'reports', scope: 'organization', organizationIds: ['org'] }] } })
    await until(() => !f.text().includes('旧授权角色数据'))
    assert.deepEqual(f.errors, [])
  } finally { await f.close() }
})

test('version-prefixed static delivery serves relative resources and preserves missing-resource 404', async () => {
  const prefix = '/sub-apps/report-center/versions/1.0.0/'
  const server = await preview({ configFile, base: prefix, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  try {
    const base = `http://127.0.0.1:${server.httpServer.address().port}${prefix}`
    for (const [name, mime] of [['index.html', /html/], ['report-center.umd.js', /javascript/], ['report-center.css', /css/]]) {
      const response = await fetch(new URL(name, base), { headers: { Origin: 'https://platform.example.test' } })
      assert.equal(response.status, 200, name)
      assert.match(response.headers.get('content-type'), mime)
      assert.equal(response.headers.get('access-control-allow-origin'), '*')
    }
    for (const missing of ['missing.js', 'missing.css', 'missing-route']) {
      assert.equal((await fetch(new URL(missing, base), { headers: { Accept: 'text/html' } })).status, 404)
    }
  } finally {
    server.httpServer.closeAllConnections()
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
})

test('vendored SDK files match the SDK 2 artifact manifest', async () => {
  const manifest = JSON.parse(await read('vendor/micro-sdk/artifact-manifest.json'))
  assert.equal(manifest.sdkVersion, SDK_VERSION)
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(`../vendor/micro-sdk/${file.path}`, import.meta.url))
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
  }
})
