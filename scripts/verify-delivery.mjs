import assert from 'node:assert/strict'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyBuildProvenance } from './build-provenance.mjs'

export const repository = fileURLToPath(new URL('../', import.meta.url))
export const applications = [
  { directory: 'micro-vue', appCode: 'vue-workshop', selector: '#app', source: 'public/vendor/micro-sdk.SOURCE.json' },
  { directory: 'micro-jquery', appCode: 'legacy-jquery', selector: '#app', source: 'public/vendor/micro-sdk.SOURCE.json' },
  { directory: 'report-center', appCode: 'report-center', selector: '#report-center-root', source: 'vendor/micro-sdk/SOURCE.json' },
  { directory: 'websocket', appCode: 'websocket-chat', selector: '#root', source: 'vendor/micro-app-sdk/3.0.0/SOURCE.json' },
  { directory: 'oauth-playground/frontend', appCode: 'oauth-playground', selector: '#oauth-playground-root', source: 'vendor/micro-sdk/SOURCE.json' },
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const lifecycleKeys = ['bootstrap', 'mount', 'unmount', 'update']
const require = createRequire(new URL('../micro-vue/package.json', import.meta.url))
const happyDom = import(pathToFileURL(require.resolve('happy-dom')))

export function relativeAsset(value) {
  assert.ok(typeof value === 'string' && value && !/[\\?#%]/.test(value) && !value.startsWith('/') && !value.includes(':'), `Unsafe delivery resource: ${value}`)
  const resource = value.replace(/^\.\//, '')
  assert.ok(resource.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe delivery resource: ${value}`)
  return resource
}

export async function parseEntry(html) {
  const { Window } = await happyDom
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })
  try {
    // HTML parsing, rather than text matching, decodes named/numeric entities,
    // honors raw-text script elements, and excludes commented-out markup.
    window.document.write(html)
    assert.ok(!window.document.querySelector('base[href]'), 'Delivery must not change relative resource resolution with a base element')
    const scripts = [], styles = []
    for (const element of window.document.querySelectorAll('script')) {
      const type = (element.getAttribute('type') || '').toLowerCase()
      assert.notEqual(type, 'module', 'Native module delivery is unsupported')
      if (type && !['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type.trim())) continue
      const source = element.getAttribute('src')
      scripts.push(source === null ? { code: element.textContent } : { src: relativeAsset(source) })
    }
    for (const element of window.document.querySelectorAll('link')) {
      const relations = (element.getAttribute('rel') || '').toLowerCase().split(/\s+/)
      assert.ok(!relations.includes('modulepreload'), 'Native modulepreload delivery is unsupported')
      if (relations.includes('stylesheet')) styles.push(relativeAsset(element.getAttribute('href')))
    }
    assert.ok(scripts.some(script => script.src), 'No classic script entry')
    return { scripts, styles }
  } finally { await window.happyDOM.close() }
}

export async function filesIn(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name, absolute = path.join(directory, entry.name)
    assert.ok(!(await lstat(absolute)).isSymbolicLink(), `Delivery contains a symlink: ${relative}`)
    if (entry.isDirectory()) files.push(...await filesIn(absolute, relative + '/'))
    else {
      assert.ok(!/(?:^|\/)(?:node_modules|backend|\.git|\.env[^/]*)(?:\/|$)|\.(?:map|ts|tsx|rs|pem|key)$/i.test(relative), `Private/source file in delivery: ${relative}`)
      const bytes = await readFile(absolute)
      files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function exerciseLifecycle(application, scripts, directory) {
  const { Window } = await happyDom
  const window = new Window({ url: `https://platform.example.test/micro/${application.appCode}` })
  const writes = Object.create(null)
  let proxy
  const bind = new Set(['getComputedStyle', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'addEventListener', 'removeEventListener'])
  proxy = new Proxy(writes, {
    has: (target, key) => Reflect.has(target, key) || Reflect.has(window, key),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined
      if (['window', 'self', 'globalThis'].includes(key)) return proxy
      if (Reflect.has(target, key)) return Reflect.get(target, key)
      const value = Reflect.get(window, key, window)
      return bind.has(key) && typeof value === 'function' ? value.bind(window) : value
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  })
  Object.assign(writes, {
    __POWERED_BY_QIANKUN__: true, AbortController, AbortSignal, Headers, Response, URL, TextEncoder, TextDecoder,
    fetch: async (_url, options) => {
      assert.ok(!options?.headers?.Authorization, 'delivery verification never supplies a live platform token to a network')
      return new Response(JSON.stringify({ publicOrigin: window.location.origin, platformOrigin: window.location.origin,
        scope: 'profile', flows: {} }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  window.document.body.innerHTML = `<section id="host">host sentinel</section><section id="container"><div id="${application.selector.slice(1)}"></div></section>`
  if (application.appCode === 'websocket-chat') window.document.querySelector('#root').className = 'saas-websocket-chat'
  const container = window.document.querySelector('#container')
  const context = vm.createContext({ proxy })
  let lifecycle
  try {
    for (const script of scripts) {
      const source = script.src || 'inline-entry.js'
      const code = script.src ? await readFile(path.join(directory, script.src), 'utf8') : script.code
      assert.doesNotMatch(code, /MicroIframe|installIframeBridge|__MICRO_APP__/, `Legacy loader in ${application.appCode}/${source}`)
      vm.runInContext(`;(function(window,self,globalThis){with(window){;${code}\n}}).bind(proxy)(proxy,proxy,proxy);`, context, { filename: source, timeout: 15000 })
    }
    lifecycle = proxy[application.appCode]
    assert.ok(lifecycle, `${application.appCode}: final classic script must export its lifecycle`)
    assert.deepEqual(Object.keys(lifecycle).sort(), lifecycleKeys)
    for (const key of lifecycleKeys) assert.equal(typeof lifecycle[key], 'function')
    const platform = {
      sdkVersion: '3.0.0', contractVersion: '2.0', appCode: application.appCode,
      token: 'delivery-test-only-token', contextVersion: 'delivery-test', contextEpoch: 1,
      expiresAt: new Date(Date.now() + 60000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
      basePath: `/micro/${application.appCode}`, routePath: `/micro/${application.appCode}`, theme: 'light',
      user: { id: '019a0b00-0000-7000-8000-000000000001', username: 'test', displayName: 'Test' },
      tenant: { id: '019a0b00-0000-7000-8000-000000000002', code: 'test', name: 'Test' },
      organization: { id: '019a0b00-0000-7000-8000-000000000003', name: 'Test', path: '/test' }, organizationScopeIds: [], roles: [], permissions: [], dataGrants: [], menus: [],
      signal: new AbortController().signal, onNavigate() {}, onNotify() {},
    }
    await lifecycle.bootstrap({})
    for (const sdkVersion of ['1.0.0', '2.0.0']) {
      await assert.rejects(lifecycle.mount({ container, platform: { ...platform, sdkVersion } }), `${application.appCode} must reject SDK ${sdkVersion} context`)
    }
    await lifecycle.mount({ container, platform })
    await lifecycle.update({ platform: { ...platform, theme: 'dark' } })
    assert.equal(window.document.querySelector('#host').textContent, 'host sentinel')
    assert.equal(proxy.MicroIframe, undefined)
    assert.equal(proxy.__MICRO_APP__, undefined)
    await lifecycle.unmount()
    assert.equal(container.querySelector(application.selector).textContent, '')
  } finally {
    await lifecycle?.unmount?.()
    await window.happyDOM.close()
  }
}

export async function verifyDelivery() {
  const lock = JSON.parse(await readFile(path.join(repository, 'dependencies.lock.json'), 'utf8'))
  assert.equal(lock.sdkVersion, '3.0.0')
  const manifests = []
  for (const application of applications) {
    const directory = path.join(repository, application.directory, 'dist')
    const buildProvenance = await verifyBuildProvenance(application.directory, directory)
    const html = await readFile(path.join(directory, 'index.html'), 'utf8')
    const { scripts, styles } = await parseEntry(html)
    const files = await filesIn(directory)
    for (const resource of [...scripts.filter(script => script.src).map(script => script.src), ...styles]) {
      assert.ok(!resource.includes('@vite/client'), 'Development HMR scripts cannot enter delivery')
      assert.ok(files.some(file => file.path === resource), `Missing emitted asset: ${application.appCode}/${resource}`)
    }
    const sdkSource = JSON.parse(await readFile(path.join(repository, application.directory, application.source), 'utf8'))
    assert.equal(sdkSource.sdkVersion, '3.0.0')
    assert.equal(sdkSource.baseCommit, lock.baseCommit)
    assert.equal(sdkSource.workingTree, lock.workingTree)
    await exerciseLifecycle(application, scripts, directory)
    manifests.push({ schemaVersion: 1, appCode: application.appCode, sdkVersion: '3.0.0', contractVersion: '2.0',
      entry: 'index.html', lifecycles: lifecycleKeys, sdkSource, buildProvenance, files })
    console.log(`Verified classic HTML lifecycle and SDK 3: ${application.appCode} (${files.length} files)`)
  }
  return manifests
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./check-inputs.mjs')
  await verifyDelivery()
}
