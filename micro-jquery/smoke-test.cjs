// Actual jQuery lifecycle handlers with deterministic DOM/events and delayed fetch completions.
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
function element() {
  const attributes = {}
  return { innerHTML: '', textContent: '', style: {}, className: '', children: [],
    setAttribute(k, v) { attributes[k] = v }, removeAttribute(k) { delete attributes[k] }, getAttribute(k) { return attributes[k] },
    appendChild(child) { this.children.push(child) },
  }
}
function setup() {
  let clockNow = Date.now(), id = 0, markup = ''
  class Clock extends Date { static now() { return clockNow } }
  const timers = new Map(), requests = [], notifications = [], events = new Map(), signal = trackedSignal(), nodes = new Map()
  const container = {
    ...element(), get innerHTML() { return markup },
    set innerHTML(value) {
      markup = value; nodes.clear()
      for (const match of value.matchAll(/id="([^"]+)"/g)) nodes.set('#' + match[1], element())
      for (const cls of ['mf-jq-upd-badge', 'mf-jq-route', 'mf-jq-header', 'mf-jq-tokenbox', 'mf-jq-sub']) nodes.set('.' + cls, element())
    },
    querySelector(selector) { return nodes.get(selector) || null },
  }
  const document = {
    getElementById: id => container.querySelector('#' + id),
    querySelector: selector => container.querySelector(selector),
    querySelectorAll: () => [], createElement: () => element(),
  }
  function jquery(target) {
    return {
      jquery: '3.7-test',
      off(namespace) { for (const [key, entry] of events) if (entry.event.includes(namespace)) events.delete(key); return this },
      on(eventList, selector, handler) { for (const event of eventList.split(' ')) events.set(event + selector, { event, selector, handler }); return this },
      data(key) { return target && target.dataset && target.dataset[key] },
      val() { return target && target.value },
    }
  }
  jquery.fn = { jquery: '3.7-test' }
  const window = { jQuery: jquery,
    setInterval(fn) { timers.set(++id, fn); return id }, clearInterval(timerId) { timers.delete(timerId) },
  }
  vm.runInNewContext(sdkCode + '\n' + code + '\n' + qiankunCode, {
    window, document, AbortController, Date: Clock, console, Headers, URL, TextEncoder, TextDecoder, DOMException, Uint8Array, Response, ReadableStream, crypto,
    fetch(url, options) { const result = deferred(); requests.push({ url, options, ...result }); return result.promise },
  })
  const props = {
    sdkVersion: window.MicroSdk.SDK_VERSION, contractVersion: '2.0', appCode: 'legacy-jquery', contextVersion: 'context-a', contextEpoch: 1,
    expiresAt: new Date(clockNow + 30000).toISOString(), tokenExpiresAt: new Date(clockNow + 300000).toISOString(),
    basePath: '/micro/legacy-jquery', routePath: '/micro/legacy-jquery', token: 'application-token-a',
    user: { id: '019c0000-0000-7000-8000-000000000002', username: 'admin', displayName: 'Admin' }, tenant: { id: '019c0000-0000-7000-8000-000000000003', code: 'alpha', name: 'Alpha' },
    organization: { id: '019c0000-0000-7000-8000-000000000004', name: 'Organization A', path: '/a' },
    roles: [{ id: '019c0000-0000-7000-8000-000000000006', name: 'Viewer', code: 'viewer' }], permissions: ['ticket:read'],
    dataGrants: [{ resource: 'ticket', action: 'read', scope: 'ORG', subjectUserId: '019c0000-0000-7000-8000-000000000002', tenantId: '019c0000-0000-7000-8000-000000000003', organizationIds: ['019c0000-0000-7000-8000-000000000004'] }],
    theme: 'light', menus: [{ id: '019c0000-0000-7000-8000-000000000007', type: 'MENU', title: 'Ticket overview' }], signal: signal.signal,
    onNotify: (...args) => notifications.push(args), onNavigate() {},
  }
  const wrapper = { querySelector: selector => selector === '#app' ? container : null }
  return {
    lifecycle: window['legacy-jquery'], qiankun: window['legacy-jquery'], window, props, requests, signal, timers, events, notifications, container, wrapper,
    find: selector => container.querySelector(selector),
    click(selector) { return events.get('click.mfjq' + selector).handler.call(element()) },
    change(selector, value) { return events.get('change.mfjq' + selector).handler.call({ value }) },
    advance(ms) { clockNow += ms; for (const tick of timers.values()) tick() },
  }
}
function response(body, status = 200) { return new Response(JSON.stringify(body), { status }) }
function delayedResponse(promise) { return new Response(new ReadableStream({ async pull(controller) { const value = await promise; try { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close() } catch {} } })) }
const settle = () => new Promise(resolve => setImmediate(resolve))

test('MicroProps 2.0 displays tenant, organization, roles, operations and independent grants', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const output = t.find('#mf-jq-context').innerHTML
  for (const value of ['Alpha', 'Organization A', 'Viewer', 'ticket:read', 'ORG', '019c0000-0000-7000-8000-000000000004', 'Ticket overview']) assert.ok(output.includes(value), value)
  t.click('#mf-jq-btn-notify'); assert.deepEqual(t.notifications[0], ['来自 jQuery 遗留系统的消息', 'info'])
  t.change('#mf-jq-search', '数据库')
  const filtered = t.find('#mf-jq-tbody').innerHTML
  await t.lifecycle.update({ platform: { ...t.props, routePath: '/micro/legacy-jquery/other', theme: 'dark' } })
  assert.equal(t.find('#mf-jq-tbody').innerHTML, filtered)
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('dark'))
  assert.ok(t.find('.mf-jq-route').innerHTML.includes('/other')); await t.lifecycle.unmount()
})
test('renewed token aborts old request, refuses late response and sends new token', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const oldRequest = t.click('#mf-jq-btn-menus')
  assert.equal(t.requests[0].options.headers.get('Authorization'), 'Bearer application-token-a')
  assert.equal(t.requests[0].options.credentials, 'omit')
  assert.equal(t.window.MicroSdk.sdkVersion, t.props.sdkVersion)
  await t.lifecycle.update({ platform: { ...t.props, token: 'application-token-b', contextEpoch: 2 } })
  assert.equal(t.requests[0].options.signal.aborted, true)
  t.requests[0].resolve(response({ menus: [{ title: 'old organization' }] })); await oldRequest
  assert.equal(t.find('#mf-jq-menu-list').innerHTML, '')
  const newRequest = t.click('#mf-jq-btn-menus')
  assert.equal(t.requests[1].options.headers.get('Authorization'), 'Bearer application-token-b')
  t.requests[1].resolve(response({ menus: [{ title: 'fresh menu' }] })); await newRequest
  assert.ok(t.find('#mf-jq-menu-list').innerHTML.includes('fresh menu')); await t.lifecycle.unmount()
})
test('organization changes reject delayed JSON and replace independent permissions', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const pending = t.click('#mf-jq-btn-menus'), json = deferred()
  t.requests[0].resolve(delayedResponse(json.promise)); await settle()
  await t.lifecycle.update({ platform: { ...t.props, contextVersion: 'context-b', contextEpoch: 2,
    organization: { id: '019c0000-0000-7000-8000-000000000005', name: 'Organization B', path: '/b' }, roles: [], permissions: [], dataGrants: [], menus: [] } })
  json.resolve({ menus: [{ title: 'old organization' }] }); await pending
  assert.equal(t.find('#mf-jq-menu-list').innerHTML, '')
  const output = t.find('#mf-jq-context').innerHTML
  assert.ok(output.includes('Organization B')); assert.ok(!output.includes('Organization A'))
  assert.ok(!output.includes('ticket:read')); assert.ok(!output.includes('Viewer')); await t.lifecycle.unmount()
})
test('host cancellation and expiry block requests and erase old authorized results', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const pending = t.click('#mf-jq-btn-menus'); t.signal.controller.abort()
  assert.equal(t.requests[0].options.signal.aborted, true)
  t.requests[0].resolve(response({ menus: [{ title: 'late' }] })); await pending
  assert.equal(t.find('#mf-jq-menu-list').innerHTML, '')
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('上下文已失效'))
  await t.click('#mf-jq-btn-menus'); assert.equal(t.requests.length, 1)
  const fresh = trackedSignal(); await t.lifecycle.update({ platform: { ...t.props, signal: fresh.signal, contextEpoch: 2 } })
  t.advance(31000); await t.click('#mf-jq-btn-menus'); assert.equal(t.requests.length, 1)
  assert.equal(t.find('#mf-jq-btn-menus').disabled, true); await t.lifecycle.unmount()
})
test('repeated mounting cleans document listeners, intervals and host listeners', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const eventCount = t.events.size; assert.ok(eventCount > 0); assert.equal(t.timers.size, 1)
  await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  assert.equal(t.events.size, eventCount); assert.equal(t.timers.size, 1); assert.equal(t.signal.listeners.size, 1)
  const pending = t.click('#mf-jq-btn-menus'), detachedList = t.find('#mf-jq-menu-list')
  await t.lifecycle.unmount(); await t.lifecycle.unmount()
  assert.equal(t.events.size, 0); assert.equal(t.timers.size, 0); assert.equal(t.signal.listeners.size, 0)
  assert.equal(t.container.innerHTML, '')
  t.requests[0].resolve(response({ menus: [{ title: 'unmounted' }] })); await pending
  assert.equal(detachedList.innerHTML, '')
  await t.lifecycle.update({ platform: t.props }); assert.equal(t.signal.listeners.size, 0)
  await t.lifecycle.mount({ container: t.wrapper, platform: t.props }); assert.equal(t.timers.size, 1); await t.lifecycle.unmount()
})
test('qiankun rejects obsolete and malformed platform context and escapes values', async () => {
  const t = setup()
  await assert.rejects(t.lifecycle.mount({ container: t.wrapper, platform: { ...t.props, contractVersion: '1.0' } }), /MicroProps 2.0/)
  await t.lifecycle.mount({ container: t.wrapper, platform: { ...t.props, tenant: { ...t.props.tenant, name: '<img onerror=alert(1)>' } } })
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('&lt;img'))
  assert.ok(!t.find('#mf-jq-context').innerHTML.includes('<img'))
  await assert.rejects(t.lifecycle.update({ platform: { ...t.props, signal: undefined } }), /MicroProps 2.0/)
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('上下文已失效')); await t.lifecycle.unmount()
})

test('display updates preserve pending reads while same-hash grant replacement cancels and clears them', async () => {
  const t = setup(); await t.lifecycle.mount({ container: t.wrapper, platform: t.props })
  const display = t.click('#mf-jq-btn-menus')
  await t.lifecycle.update({ platform: { ...t.props, theme: 'dark' } })
  assert.equal(t.requests[0].options.signal.aborted, false)
  t.requests[0].resolve(response({ menus: [{ title: 'same authorization' }] })); await display
  assert.ok(t.find('#mf-jq-menu-list').innerHTML.includes('same authorization'))
  const old = t.click('#mf-jq-btn-menus')
  await t.lifecycle.update({ platform: { ...t.props, theme: 'dark', permissions: [], dataGrants: [] } })
  assert.equal(t.requests[1].options.signal.aborted, true)
  t.requests[1].resolve(response({ menus: [{ title: 'removed authorization' }] })); await old
  assert.equal(t.find('#mf-jq-menu-list').innerHTML, '')
  await t.lifecycle.unmount()
})

test('qiankun final export scopes mounting and forwards authorization updates with full cleanup', async () => {
  const t = setup()
  assert.equal(Object.keys(t.window).at(-1), 'legacy-jquery', 'final script exposes the lifecycle qiankun discovers')
  assert.equal(t.window.__MICRO_APP__, undefined)
  assert.deepEqual(Object.keys(t.qiankun).sort(), ['bootstrap', 'mount', 'unmount', 'update'])
  await t.qiankun.bootstrap()
  assert.equal(t.timers.size, 0); assert.equal(t.events.size, 0)
  const wrapper = { innerHTML: 'qiankun wrapper', querySelector(selector) { assert.equal(selector, '#app'); return t.container } }
  await t.qiankun.mount({ name: 'legacy-jquery', container: wrapper, platform: t.props })
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('Organization A'))
  assert.equal(wrapper.innerHTML, 'qiankun wrapper')
  t.change('#mf-jq-search', '数据库')
  const rows = t.find('#mf-jq-tbody').innerHTML
  await t.qiankun.update({ platform: { ...t.props, routePath: '/micro/legacy-jquery/other', theme: 'dark' } })
  assert.equal(t.find('#mf-jq-tbody').innerHTML, rows)
  assert.ok(t.find('.mf-jq-route').innerHTML.includes('/other'))
  const pending = t.click('#mf-jq-btn-menus')
  await t.qiankun.update({ platform: { ...t.props, contextEpoch: 2, token: 'renewed-token', permissions: [], dataGrants: [] } })
  assert.equal(t.requests[0].options.signal.aborted, true)
  t.requests[0].resolve(response({ menus: [{ title: 'stale authorization' }] })); await pending
  assert.equal(t.find('#mf-jq-menu-list').innerHTML, '')
  const fresh = t.click('#mf-jq-btn-menus')
  assert.equal(t.requests[1].options.headers.get('Authorization'), 'Bearer renewed-token')
  await t.qiankun.unmount()
  assert.equal(t.requests[1].options.signal.aborted, true)
  t.requests[1].resolve(response({ menus: [{ title: 'unmounted' }] })); await fresh
  assert.equal(t.events.size, 0); assert.equal(t.timers.size, 0); assert.equal(t.signal.listeners.size, 0)
  assert.equal(t.container.innerHTML, ''); assert.equal(wrapper.innerHTML, 'qiankun wrapper')
  await t.qiankun.unmount()
  await t.qiankun.mount({ container: wrapper, platform: t.props })
  assert.equal(t.timers.size, 1); await t.qiankun.unmount()
})

test('qiankun rejects missing local roots, invalid nested context and direct MicroProps calls', async () => {
  const t = setup()
  await assert.rejects(t.qiankun.mount({ platform: t.props }), /#app inside props.container/)
  await assert.rejects(t.qiankun.mount({ container: { querySelector: () => null }, platform: t.props }), /#app inside props.container/)
  assert.equal(t.container.innerHTML, '')
  const wrapper = { querySelector: () => t.container }
  await assert.rejects(t.qiankun.mount({ ...t.props, container: wrapper, platform: null }), /props.platform/)
  assert.equal(t.signal.listeners.size, 0)
  await assert.rejects(t.qiankun.mount({ ...t.props, container: wrapper }), /props.platform/)
  await assert.rejects(t.qiankun.update({ ...t.props, theme: 'dark' }), /props.platform/)
  await t.qiankun.mount({ container: wrapper, platform: t.props })
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('Organization A'))
  await t.qiankun.update({ platform: { ...t.props, theme: 'dark' } })
  assert.ok(t.find('#mf-jq-context').innerHTML.includes('dark'))
  await t.qiankun.unmount()
})
