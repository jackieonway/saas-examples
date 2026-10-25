// Exercise the actual UMD browser branch in qiankun-style separate script scopes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

async function createSandbox() {
  const { Window } = await import('happy-dom')
  const hostWindow = new Window({ url: 'http://platform.test/micro/legacy-jquery' })
  const local = Object.create(null), intervals = new Set()
  let proxy
  const boundMethods = new Set(['setTimeout', 'clearTimeout', 'getComputedStyle', 'addEventListener', 'removeEventListener'])
  proxy = new Proxy(local, {
    has: (target, key) => Reflect.has(target, key) || Reflect.has(hostWindow, key),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined
      if (key === 'window' || key === 'self' || key === 'globalThis') return proxy
      if (Reflect.has(target, key)) return Reflect.get(target, key)
      const value = Reflect.get(hostWindow, key, hostWindow)
      return boundMethods.has(key) && typeof value === 'function' ? value.bind(hostWindow) : value
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  })
  local.setInterval = function (callback, delay) {
    const id = hostWindow.setInterval(callback, delay); intervals.add(id); return id
  }
  local.clearInterval = function (id) { intervals.delete(id); hostWindow.clearInterval(id) }
  local.fetch = function () { throw new Error('vendor sandbox test must not request the network') }
  const context = vm.createContext({ proxy })
  function execute(code, filename) {
    vm.runInContext(`;(function(window, self, globalThis){with(window){;${code}\n}}).bind(proxy)(proxy, proxy, proxy);`, context, { filename })
  }
  return { hostWindow, proxy, intervals, execute, close: () => hostWindow.happyDOM.close() }
}

function props(sdkVersion) {
  const now = Date.now()
  return {
    sdkVersion, contractVersion: '2.0', appCode: 'legacy-jquery', contextVersion: 'context-a', contextEpoch: 1,
    expiresAt: new Date(now + 30000).toISOString(), tokenExpiresAt: new Date(now + 300000).toISOString(),
    basePath: '/micro/legacy-jquery', routePath: '/micro/legacy-jquery', token: 'application-token',
    user: { id: '019c0000-0000-7000-8000-000000000002', username: 'admin', displayName: 'Admin' },
    tenant: { id: '019c0000-0000-7000-8000-000000000003', code: 'alpha', name: 'Alpha' },
    organization: { id: '019c0000-0000-7000-8000-000000000004', name: 'Organization A', path: '/a' },
    roles: [{ id: '019c0000-0000-7000-8000-000000000006', name: 'Viewer', code: 'viewer' }], permissions: ['ticket:read'], dataGrants: [],
    menus: [], theme: 'light', signal: new AbortController().signal, onNotify() {}, onNavigate() {},
  }
}

test('qiankun actual jQuery UMD publishes both proxy globals and cleans mounted behavior', async () => {
  const sandbox = await createSandbox()
  try {
    const vendor = fs.readFileSync(path.join(__dirname, 'public/vendor/jquery.min.js'), 'utf8')
    assert.match(vendor, /^\/\*! jQuery v3\.7\.1[\s\S]*?jquery\.org\/license \*\//)
    const scripts = ['vendor/jquery.min.js', 'vendor/micro-sdk.js', 'app.js', 'qiankun-entry.js']
    for (const file of scripts) sandbox.execute(fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'), file)
    assert.equal(sandbox.proxy.jQuery.fn.jquery, '3.7.1')
    assert.equal(sandbox.proxy.$, sandbox.proxy.jQuery)
    sandbox.execute('window.__NEXT_SCRIPT_JQUERY__ = jQuery.fn.jquery + ":" + $.fn.jquery;', 'next-script.js')
    assert.equal(sandbox.proxy.__NEXT_SCRIPT_JQUERY__, '3.7.1:3.7.1')
    const document = sandbox.hostWindow.document
    document.body.innerHTML = '<div id="app">host content</div><main><div id="app"></div></main>'
    const wrapper = document.querySelector('main'), hostRoot = document.body.firstElementChild
    const lifecycle = sandbox.proxy['legacy-jquery'], platform = props(sandbox.proxy.MicroSdk.SDK_VERSION)
    assert.equal(sandbox.proxy.__MICRO_APP__, undefined)
    assert.equal(sandbox.proxy.MicroIframe, undefined)
    assert.deepEqual(Object.keys(lifecycle).sort(), ['bootstrap', 'mount', 'unmount', 'update'])
    await lifecycle.bootstrap()
    await lifecycle.mount({ container: wrapper, platform })
    assert.ok(wrapper.textContent.includes('Organization A'))
    assert.equal(hostRoot.textContent, 'host content')
    await lifecycle.update({ platform: { ...platform, theme: 'dark', routePath: '/micro/legacy-jquery/other' } })
    assert.ok(wrapper.textContent.includes('/micro/legacy-jquery/other'))
    assert.ok(sandbox.proxy.jQuery._data(document, 'events'), 'real jQuery delegated events are installed')
    await lifecycle.unmount()
    assert.equal(sandbox.proxy.jQuery._data(document, 'events'), undefined)
    assert.equal(wrapper.querySelector('#app').innerHTML, '')
    assert.equal(sandbox.intervals.size, 0)
    for (const key of ['jQuery', '$', 'MicroSdk', '__MICRO_APP__', 'legacy-jquery', '__JQ_APP_MARKER']) {
      assert.equal(sandbox.hostWindow[key], undefined, `${key} must stay on the proxy window`)
    }
  } finally { await sandbox.close() }
})
