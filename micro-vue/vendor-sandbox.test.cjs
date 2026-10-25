// Run actual browser distributions in separate function scopes, as qiankun's
// import-html-entry strictGlobal path does. Concatenating scripts hides var leaks.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

async function createSandbox() {
  const { Window } = await import('happy-dom')
  const hostWindow = new Window({ url: 'http://platform.test/micro/vue-workshop' })
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
    sdkVersion, contractVersion: '2.0', appCode: 'vue-workshop', contextVersion: 'context-a', contextEpoch: 1,
    expiresAt: new Date(now + 30000).toISOString(), tokenExpiresAt: new Date(now + 300000).toISOString(),
    basePath: '/micro/vue-workshop', routePath: '/micro/vue-workshop', token: 'application-token',
    user: { id: '019c0000-0000-7000-8000-000000000002', username: 'admin', displayName: 'Admin' },
    tenant: { id: '019c0000-0000-7000-8000-000000000003', code: 'alpha', name: 'Alpha' },
    organization: { id: '019c0000-0000-7000-8000-000000000004', name: 'Organization A', path: '/a' },
    roles: [{ id: '019c0000-0000-7000-8000-000000000006', name: 'Viewer', code: 'viewer' }], permissions: ['ticket:read'], dataGrants: [],
    menus: [], theme: 'light', signal: new AbortController().signal, onNotify() {}, onNavigate() {},
  }
}

test('qiankun original Vue var stays function-local between separate scripts', async () => {
  const sandbox = await createSandbox()
  try {
    const upstream = fs.readFileSync(path.join(__dirname, 'node_modules/vue/dist/vue.global.prod.js'), 'utf8')
    sandbox.execute(upstream, 'upstream-vue.js')
    sandbox.execute('window.__NEXT_SCRIPT_VUE__ = typeof Vue;', 'next-script.js')
    assert.equal(sandbox.proxy.__NEXT_SCRIPT_VUE__, 'undefined', 'reproduces the unadapted global-build failure')
    assert.equal(sandbox.hostWindow.Vue, undefined)
  } finally { await sandbox.close() }
})

test('qiankun actual Vue vendor survives script scopes and leaves host globals intact', async () => {
  const sandbox = await createSandbox()
  try {
    const vendor = fs.readFileSync(path.join(__dirname, 'public/vendor/vue.global.prod.js'), 'utf8')
    assert.match(vendor, /^\/\*\*[\s\S]*?vue v3\.5\.43[\s\S]*?@license MIT[\s\S]*?\*\//)
    const scripts = ['vendor/vue.global.prod.js', 'vendor/micro-sdk.js', 'app.js', 'qiankun-entry.js']
    for (const file of scripts) sandbox.execute(fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'), file)
    assert.equal(sandbox.proxy.Vue.version, '3.5.43')
    sandbox.execute('window.__NEXT_SCRIPT_VUE__ = Vue.version;', 'next-script.js')
    assert.equal(sandbox.proxy.__NEXT_SCRIPT_VUE__, '3.5.43')
    const document = sandbox.hostWindow.document
    document.body.innerHTML = '<div id="app">host content</div><main><div id="app"></div></main>'
    const wrapper = document.querySelector('main'), hostRoot = document.body.firstElementChild
    const lifecycle = sandbox.proxy['vue-workshop'], platform = props(sandbox.proxy.MicroSdk.SDK_VERSION)
    assert.equal(sandbox.proxy.__MICRO_APP__, undefined)
    assert.equal(sandbox.proxy.MicroIframe, undefined)
    assert.deepEqual(Object.keys(lifecycle).sort(), ['bootstrap', 'mount', 'unmount', 'update'])
    await lifecycle.bootstrap()
    await lifecycle.mount({ container: wrapper, platform })
    assert.ok(wrapper.textContent.includes('Organization A'), 'real Vue renders through the exported sandbox library')
    assert.equal(hostRoot.textContent, 'host content')
    await lifecycle.update({ platform: { ...platform, theme: 'dark', routePath: '/micro/vue-workshop/security' } })
    await sandbox.proxy.Vue.nextTick()
    assert.ok(wrapper.textContent.includes('/micro/vue-workshop/security'))
    await lifecycle.unmount()
    assert.equal(wrapper.querySelector('#app').innerHTML, '')
    assert.equal(sandbox.intervals.size, 0)
    for (const key of ['Vue', 'MicroSdk', '__MICRO_APP__', 'vue-workshop', '__VUE_APP_MARKER']) {
      assert.equal(sandbox.hostWindow[key], undefined, `${key} must stay on the proxy window`)
    }
  } finally { await sandbox.close() }
})
