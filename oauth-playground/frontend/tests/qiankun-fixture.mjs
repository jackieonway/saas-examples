import assert from 'node:assert/strict'
import { readFile, realpath, mkdtemp, rm, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { build } from 'vite'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const settle = () => new Promise(resolve => setImmediate(resolve))
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
export const publicConfig = {
  publicOrigin: 'https://platform.test', platformOrigin: 'https://platform.test', scope: 'profile',
  flows: Object.fromEntries(['authorization_code', 'device', 'client_credentials', 'password'].map(flow => [flow, { enabled: true }])),
}

export function platformProps(extra = {}) {
  return {
    sdkVersion: '2.0.0', contractVersion: '2.0', appCode: 'oauth-playground',
    basePath: '/micro/oauth-playground', routePath: '/micro/oauth-playground',
    contextVersion: 'context-a', contextEpoch: 1,
    expiresAt: new Date(Date.now() + 300000).toISOString(), tokenExpiresAt: new Date(Date.now() + 600000).toISOString(),
    token: 'sentinel-platform-bearer', signal: new AbortController().signal,
    user: { id: 'user-a', username: 'admin', displayName: 'Admin' },
    tenant: { id: 'tenant-a', code: 'alpha', name: 'Alpha' },
    organization: { id: 'org-a', name: 'Organization A', path: '/a' }, organizationScopeIds: null,
    roles: [], permissions: [], dataGrants: [], menus: [], theme: 'light', onNotify() {}, onNavigate() {}, ...extra,
  }
}

export async function buildFixture() {
  const tempBase = await realpath(os.tmpdir())
  const temporaryRoot = await realpath(await mkdtemp(path.join(tempBase, 'oauth-qiankun-')))
  const outDir = path.join(temporaryRoot, 'dist')
  assert.equal(path.dirname(path.resolve(outDir)), temporaryRoot)
  const fixture = {
    outDir,
    async close() {
      assert.equal(path.dirname(temporaryRoot), tempBase)
      assert.ok(path.basename(temporaryRoot).startsWith('oauth-qiankun-'))
      assert.equal((await lstat(temporaryRoot)).isSymbolicLink(), false)
      assert.equal(await realpath(temporaryRoot), temporaryRoot)
      await rm(temporaryRoot, { recursive: true, force: true })
    },
  }
  try {
    await build({ configFile: path.join(root, 'vite.config.mjs'), build: { outDir, emptyOutDir: true } })
    return fixture
  } catch (error) { await fixture.close(); throw error }
}

export async function entryFiles(outDir, file = 'index.html') {
  const html = await readFile(path.join(outDir, file), 'utf8')
  const scripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>/gi)].map(([, attributes, src]) => ({ attributes, src }))
  const styles = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi)].map(([, src]) => src)
  return { html, scripts, styles }
}

// A separate with(window) function for every emitted script reproduces
// import-html-entry's strictGlobal scope; writes stay on the proxy window.
export async function sandbox(outDir, { file = 'index.html', fetchImpl, url = 'https://platform.test/micro/oauth-playground?host=keep#host' } = {}) {
  const window = new Window({ url }), writes = Object.create(null), requests = [], listeners = new Set(), tasks = new Map(), failures = []
  let proxy, nextTimer = 0, now = Date.now()
  class Clock extends Date { static now() { return now } }
  const boundMethods = new Set(['getComputedStyle'])
  proxy = new Proxy(writes, {
    has: (target, key) => Reflect.has(target, key) || Reflect.has(window, key),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined
      if (key === 'window' || key === 'self' || key === 'globalThis') return proxy
      if (Reflect.has(target, key)) return Reflect.get(target, key)
      const value = Reflect.get(window, key, window)
      return boundMethods.has(key) && typeof value === 'function' ? value.bind(window) : value
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  })
  const schedule = (callback, delay, interval) => { const id = ++nextTimer; tasks.set(id, { callback, at: now + delay, interval }); return id }
  Object.assign(writes, {
    Date: Clock, AbortController, AbortSignal, Headers, URL, TextEncoder, TextDecoder, DOMException, Response, ReadableStream, crypto,
    setTimeout: (callback, delay = 0) => schedule(callback, delay, 0), clearTimeout: id => tasks.delete(id),
    setInterval: (callback, delay = 0) => schedule(callback, delay, Math.max(1, delay)), clearInterval: id => tasks.delete(id),
    addEventListener(type, callback, options) { listeners.add(callback); window.addEventListener(type, callback, options) },
    removeEventListener(type, callback, options) { listeners.delete(callback); window.removeEventListener(type, callback, options) },
    async fetch(url, options = {}) {
      const request = { url: String(url), ...options, headers: new Headers(options.headers) }; requests.push(request)
      if (fetchImpl) return fetchImpl(request)
      return json(publicConfig)
    },
  })
  const historyCalls = [], initialHref = window.location.href
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method].bind(window.history)
    window.history[method] = (...args) => { historyCalls.push({ method, args }); return original(...args) }
  }
  const { html, scripts } = await entryFiles(outDir, file)
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || ''
  window.document.body.innerHTML = '<section id="host"><div id="app">host sentinel</div><div id="notice">host notice</div><button data-flow="password">host button</button></section><section id="micro-container"></section>'
  const container = window.document.querySelector('#micro-container')
  container.innerHTML = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  const hostMarkup = window.document.querySelector('#host').innerHTML
  const context = vm.createContext({ proxy })
  try {
    for (const { src } of scripts) {
      // The standalone host /callback page uses the fixed static alias, while
      // the qiankun entry keeps version-relative assets. Both refer to this dist.
      const resource = src.replace(/^\/sub\/oauth-playground\//, '').replace(/^\.\//, '').split('?')[0]
      const code = await readFile(path.join(outDir, resource), 'utf8')
      vm.runInContext(`;(function(window,self,globalThis){with(window){;${code}\n}}).bind(proxy)(proxy,proxy,proxy);`, context, { filename: src })
    }
  } catch (error) { await window.happyDOM.close(); throw error }
  return {
    window, proxy, container, requests, tasks, listeners, historyCalls, initialHref, hostMarkup, now: () => now,
    lifecycle: proxy['oauth-playground'],
    query: selector => container.querySelector(selector),
    async flush() { for (let i = 0; i < 4; i++) await settle(); assert.deepEqual(failures, []) },
    async advance(milliseconds) {
      const end = now + milliseconds
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        const [id, task] = next; now = task.at; tasks.delete(id)
        if (task.interval) tasks.set(id, { ...task, at: now + task.interval })
        try { Promise.resolve(task.callback()).catch(error => failures.push(error)) } catch (error) { failures.push(error) }
        await settle()
      }
      now = end; await settle(); assert.deepEqual(failures, [])
    },
    async close() {
      await proxy['oauth-playground']?.unmount?.()
      tasks.clear()
      await window.happyDOM.close()
    },
  }
}
