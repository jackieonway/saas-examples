// Exercise actual lifecycle and request handlers; fetch deliberately ignores AbortSignal.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const code = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8')
const sdkCode = fs.readFileSync(path.join(__dirname, 'public/vendor/micro-sdk.js'), 'utf8')
const qiankunCode = fs.readFileSync(path.join(__dirname, 'public/qiankun-entry.js'), 'utf8')
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function trackedSignal() {
  const controller = new AbortController(), signal = controller.signal, listeners = new Set()
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = (type, fn, opts) => { if (type === 'abort') listeners.add(fn); add(type, fn, opts) }
  signal.removeEventListener = (type, fn, opts) => { listeners.delete(fn); remove(type, fn, opts) }
  return { controller, signal, listeners }
}
function setup() {
  let clockNow = Date.now(), component, instance, id = 0
  class Clock extends Date { static now() { return clockNow } }
  const timers = new Map(), requests = [], notifications = [], mounted = [], mountedContainers = [], signal = trackedSignal()
  const vue = {
    version: '3.5-test', h: (tag, props, children) => ({ tag, props, children }), reactive: o => o,
    createApp(definition) {
      component = definition
      let ownInstance
      return {
        mount(container) {
          mountedContainers.push(container)
          ownInstance = definition.data()
          for (const [key, fn] of Object.entries(definition.methods)) ownInstance[key] = fn.bind(ownInstance)
          for (const [key, fn] of Object.entries(definition.computed)) Object.defineProperty(ownInstance, key, { get: () => fn.call(ownInstance) })
          instance = ownInstance; mounted.push(instance); definition.mounted.call(instance); return instance
        },
        unmount() { definition.beforeUnmount.call(ownInstance) },
      }
    },
  }
  const window = { Vue: vue, setInterval(fn) { timers.set(++id, fn); return id }, clearInterval(timerId) { timers.delete(timerId) } }
  vm.runInNewContext(sdkCode + '\n' + code + '\n' + qiankunCode, {
    window, Vue: vue, AbortController, Date: Clock, console, Headers, URL, TextEncoder, TextDecoder, DOMException, Uint8Array, Response, ReadableStream, crypto,
    fetch(url, options) { const result = deferred(); requests.push({ url, options, ...result }); return result.promise },
  })
  const props = {
    sdkVersion: window.MicroSdk.SDK_VERSION, contractVersion: '2.0', appCode: 'vue-workshop', contextVersion: 'context-a', contextEpoch: 1,
    expiresAt: new Date(clockNow + 30000).toISOString(), tokenExpiresAt: new Date(clockNow + 300000).toISOString(),
    basePath: '/micro/vue-workshop', routePath: '/micro/vue-workshop', token: 'application-token-a',
    user: { id: 'user-1', username: 'admin', displayName: 'Admin' }, tenant: { id: 'tenant-1', code: 'alpha', name: 'Alpha' },
    organization: { id: 'org-a', name: 'Organization A', path: '/a' },
    roles: [{ id: 'role-1', name: 'Viewer', code: 'viewer' }], permissions: ['ticket:read'],
    dataGrants: [{ resource: 'ticket', action: 'read', scope: 'SELF', subjectUserId: 'user-1', tenantId: 'tenant-1', organizationIds: [] }],
    theme: 'light', menus: [{ id: 'menu-1', type: 'MENU', title: 'Ticket overview' }], signal: signal.signal,
    onNotify: (...args) => notifications.push(args), onNavigate() {},
  }
  const container = { innerHTML: '' }
  const wrapper = { querySelector: selector => selector === '#app' ? container : null }
  return {
    lifecycle: window['vue-workshop'], qiankun: window['vue-workshop'], window, props, requests, signal, timers, mounted, mountedContainers, notifications, container, wrapper,
    get instance() { return instance }, render() { return component.render.call(instance) },
    advance(ms) { clockNow += ms; for (const tick of timers.values()) tick() },
  }
}
function response(body, status = 200) { return new Response(JSON.stringify(body), { status }) }
function delayedResponse(promise) { return new Response(new ReadableStream({ async pull(controller) { const value = await promise; try { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close() } catch {} } })) }
const settle = () => new Promise(resolve => setImmediate(resolve))

test('MicroProps 2.0 displays separate roles, operations and independent data grants', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const output = JSON.stringify(t.render())
  for (const value of ['Alpha', 'Organization A', 'Viewer', 'ticket:read', 'SELF', 'Ticket overview']) assert.ok(output.includes(value), value)
  assert.equal(t.instance.p.dataGrants[0].scope, 'SELF')
  t.instance.sendNotify(); assert.deepEqual(t.notifications[0], ['来自 Vue 子应用的消息', 'success'])
  await t.lifecycle.update({ platform: { ...t.props, routePath: '/micro/vue-workshop/security', theme: 'dark' } })
  assert.equal(t.instance.p.theme, 'dark'); assert.equal(t.mounted.length, 1)
  assert.ok(JSON.stringify(t.render()).includes('沙箱计时器')); await t.lifecycle.unmount()
})
test('renewed token aborts old work, refuses late fetch and uses new Bearer token', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const oldRequest = t.instance.loadMenus()
  assert.equal(t.requests[0].options.headers.get('Authorization'), 'Bearer application-token-a')
  assert.equal(t.requests[0].options.credentials, 'omit')
  assert.equal(t.window.MicroSdk.sdkVersion, t.props.sdkVersion)
  await t.lifecycle.update({ platform: { ...t.props, token: 'application-token-b', contextEpoch: 2 } })
  assert.equal(t.requests[0].options.signal.aborted, true); assert.equal(t.instance.menus.loading, false)
  t.requests[0].resolve(response({ menus: [{ title: 'old organization' }] })); await oldRequest
  assert.equal(t.instance.menus.data, null)
  const newRequest = t.instance.loadMenus()
  assert.equal(t.requests[1].options.headers.get('Authorization'), 'Bearer application-token-b')
  t.requests[1].resolve(response({ menus: [{ title: 'fresh menu' }] })); await newRequest
  assert.equal(t.instance.menus.data.menus[0].title, 'fresh menu'); await t.lifecycle.unmount()
})
test('organization update refuses delayed JSON and clears prior roles and permissions', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const pending = t.instance.loadRoles(), json = deferred()
  t.requests[0].resolve(delayedResponse(json.promise)); await settle()
  await t.lifecycle.update({ platform: { ...t.props, contextVersion: 'context-b', contextEpoch: 2,
    organization: { id: 'org-b', name: 'Organization B', path: '/b' }, roles: [], permissions: [], dataGrants: [], menus: [] } })
  json.resolve({ organizations: [{ roles: [{ name: 'old privileged role' }] }] }); await pending
  assert.equal(t.instance.roles.data, null); assert.equal(t.instance.p.organization.id, 'org-b')
  assert.equal(t.instance.p.permissions.length, 0); assert.equal(t.instance.p.dataGrants.length, 0)
  assert.ok(!JSON.stringify(t.render()).includes('old privileged role')); await t.lifecycle.unmount()
})
test('host abort and context expiry block new requests and late responses', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const pending = t.instance.loadMenus(); t.signal.controller.abort()
  assert.equal(t.requests[0].options.signal.aborted, true)
  t.requests[0].resolve(response({ menus: [{ title: 'late' }] })); await pending
  assert.equal(t.instance.menus.data, null); assert.equal(t.instance.p.contextAvailable, false)
  await t.instance.loadMenus(); assert.equal(t.requests.length, 1)
  const fresh = trackedSignal(); await t.lifecycle.update({ platform: { ...t.props, signal: fresh.signal, contextEpoch: 2 } })
  t.advance(31000); assert.equal(t.instance.p.contextAvailable, false)
  await t.instance.loadMenus(); assert.equal(t.requests.length, 1); await t.lifecycle.unmount()
})
test('repeated mount/unmount cleans timers and host listeners, ignores late unmounted work', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props }); assert.equal(t.timers.size, 1)
  await t.lifecycle.mount({ container: t.wrapper, platform: t.props }); assert.equal(t.timers.size, 1); assert.equal(t.signal.listeners.size, 1)
  const instance = t.instance, pending = instance.loadMenus()
  await t.lifecycle.unmount(); await t.lifecycle.unmount()
  assert.equal(t.timers.size, 0); assert.equal(t.signal.listeners.size, 0); assert.equal(t.container.innerHTML, '')
  t.requests[0].resolve(response({ menus: [{ title: 'unmounted' }] })); await pending; assert.equal(instance.menus.data, null)
  await t.lifecycle.update({ platform: t.props }); assert.equal(t.signal.listeners.size, 0)
  await t.lifecycle.mount({ container: t.wrapper, platform: t.props }); assert.equal(t.timers.size, 1); await t.lifecycle.unmount()
})
test('qiankun rejects obsolete contracts and malformed platform updates', async () => {
  const t = setup()
  await assert.rejects(t.lifecycle.mount({ container: t.wrapper, platform: { ...t.props, contractVersion: '1.0' } }), /MicroProps 2.0/)
  await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  await assert.rejects(t.lifecycle.update({ platform: { ...t.props, signal: undefined } }), /MicroProps 2.0/)
  assert.equal(t.instance.p.contextAvailable, false); await t.lifecycle.unmount()
})

test('display updates preserve pending reads while same-hash grant replacement cancels and clears them', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const display = t.instance.loadMenus()
  await t.lifecycle.update({ platform: { ...t.props, theme: 'dark' } })
  assert.equal(t.requests[0].options.signal.aborted, false)
  t.requests[0].resolve(response({ menus: [{ title: 'same authorization' }] })); await display
  assert.equal(t.instance.menus.data.menus[0].title, 'same authorization')
  const old = t.instance.loadMenus()
  await t.lifecycle.update({ platform: { ...t.props, theme: 'dark', permissions: [], dataGrants: [] } })
  assert.equal(t.requests[1].options.signal.aborted, true)
  t.requests[1].resolve(response({ menus: [{ title: 'removed authorization' }] })); await old
  assert.equal(t.instance.menus.data, null)
  await t.lifecycle.unmount()
})

test('qiankun final export scopes mounting and forwards authorization updates with full cleanup', async () => {
  const t = setup()
  assert.equal(Object.keys(t.window).at(-1), 'vue-workshop', 'final script exposes the lifecycle qiankun discovers')
  assert.equal(t.window.__MICRO_APP__, undefined)
  assert.deepEqual(Object.keys(t.qiankun).sort(), ['bootstrap', 'mount', 'unmount', 'update'])
  await t.qiankun.bootstrap()
  assert.equal(t.timers.size, 0)
  const wrapper = { innerHTML: 'qiankun wrapper', querySelector(selector) { assert.equal(selector, '#app'); return t.container } }
  await t.qiankun.mount({ name: 'vue-workshop', container: wrapper, platform: t.props })
  assert.equal(t.mountedContainers[0], t.container)
  assert.equal(wrapper.innerHTML, 'qiankun wrapper')
  assert.equal(t.instance.p.organization.id, 'org-a')
  const instance = t.instance
  await t.qiankun.update({ platform: { ...t.props, routePath: '/micro/vue-workshop/security', theme: 'dark' } })
  assert.equal(t.instance, instance)
  assert.equal(t.instance.p.theme, 'dark')
  const pending = t.instance.loadMenus()
  await t.qiankun.update({ platform: { ...t.props, contextEpoch: 2, token: 'renewed-token', permissions: [], dataGrants: [] } })
  assert.equal(t.requests[0].options.signal.aborted, true)
  t.requests[0].resolve(response({ menus: [{ title: 'stale authorization' }] })); await pending
  assert.equal(t.instance.menus.data, null)
  const fresh = t.instance.loadMenus()
  assert.equal(t.requests[1].options.headers.get('Authorization'), 'Bearer renewed-token')
  await t.qiankun.unmount()
  assert.equal(t.requests[1].options.signal.aborted, true)
  t.requests[1].resolve(response({ menus: [{ title: 'unmounted' }] })); await fresh
  assert.equal(t.timers.size, 0); assert.equal(t.signal.listeners.size, 0)
  assert.equal(t.container.innerHTML, ''); assert.equal(wrapper.innerHTML, 'qiankun wrapper')
  await t.qiankun.unmount()
  await t.qiankun.mount({ container: wrapper, platform: t.props })
  assert.equal(t.timers.size, 1); await t.qiankun.unmount()
})

test('qiankun rejects missing local roots, invalid nested context and direct MicroProps calls', async () => {
  const t = setup()
  await assert.rejects(t.qiankun.mount({ platform: t.props }), /#app inside props.container/)
  await assert.rejects(t.qiankun.mount({ container: { querySelector: () => null }, platform: t.props }), /#app inside props.container/)
  assert.equal(t.mounted.length, 0)
  const wrapper = { querySelector: () => t.container }
  await assert.rejects(t.qiankun.mount({ ...t.props, container: wrapper, platform: null }), /props.platform/)
  assert.equal(t.signal.listeners.size, 0)
  await assert.rejects(t.qiankun.mount({ ...t.props, container: wrapper }), /props.platform/)
  await assert.rejects(t.qiankun.update({ ...t.props, theme: 'dark' }), /props.platform/)
  await t.qiankun.mount({ container: wrapper, platform: t.props })
  assert.equal(t.instance.p.user.id, 'user-1')
  await t.qiankun.update({ platform: { ...t.props, theme: 'dark' } })
  assert.equal(t.instance.p.theme, 'dark')
  await t.qiankun.unmount()
})
