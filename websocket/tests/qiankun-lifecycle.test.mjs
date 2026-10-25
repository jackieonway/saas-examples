import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocketLifecycle } from '../src/qiankun-lifecycle.ts';
import { SDK_VERSION } from '../vendor/micro-app-sdk/3.0.0/index.mjs';

class LocalRoot {
  dataset = {};
  textContent = '';
  replaceChildren() { this.textContent = ''; }
}
globalThis.HTMLElement = LocalRoot;

function trackedSignal() {
  const controller = new AbortController();
  const signal = controller.signal;
  const listeners = new Set();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, fn, options) => { if (type === 'abort') listeners.add(fn); add(type, fn, options); };
  signal.removeEventListener = (type, fn, options) => { listeners.delete(fn); remove(type, fn, options); };
  return { controller, signal, listeners };
}

function setup() {
  const root = new LocalRoot();
  const host = trackedSignal();
  const props = {
    sdkVersion: SDK_VERSION, contractVersion: '2.0', appCode: 'websocket-chat',
    basePath: '/micro/websocket-chat', routePath: '/micro/websocket-chat', theme: 'light',
    token: 'application-token', contextVersion: 'context-1', contextEpoch: 1,
    expiresAt: new Date(Date.now() + 30000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
    user: { id: '019c0000-0000-7000-8000-000000000002', username: 'alice', displayName: 'Alice' },
    tenant: { id: '019c0000-0000-7000-8000-000000000003', code: 'tenant', name: 'Tenant' }, organization: { id: '019c0000-0000-7000-8000-000000000004', name: 'Org', path: '/org' },
    organizationScopeIds: ['019c0000-0000-7000-8000-000000000004'], roles: [], permissions: [], dataGrants: [], menus: [],
    signal: host.signal, onNavigate() {}, onNotify() {},
  };
  let mounts = 0, disposals = 0;
  const lifecycle = createSocketLifecycle(target => {
    mounts++;
    target.textContent = 'chat';
    return () => { disposals++; target.replaceChildren(); };
  });
  const container = { querySelector(selector) { assert.equal(selector, '#root'); return root; } };
  return { root, host, props, container, lifecycle, get mounts() { return mounts; }, get disposals() { return disposals; } };
}

test('standard qiankun exports require a local root and nested platform context', async () => {
  const t = setup();
  assert.deepEqual(Object.keys(t.lifecycle), ['bootstrap', 'mount', 'update', 'unmount']);
  await t.lifecycle.bootstrap();
  assert.equal(t.mounts, 0);
  await assert.rejects(t.lifecycle.mount({ ...t.props, container: t.container }), /props.platform/);
  await assert.rejects(t.lifecycle.mount({ platform: t.props }), /#root/);
  await assert.rejects(t.lifecycle.mount({ platform: t.props, container: { querySelector: () => null } }), /#root/);
  await assert.rejects(t.lifecycle.mount({ container: t.container, platform: { ...t.props, sdkVersion: '1.0.0' } }), { code: 'UNSUPPORTED_SDK_VERSION' });
  assert.equal(t.host.listeners.size, 0);
  await t.lifecycle.mount({ container: t.container, platform: t.props, services: { downloadCsv() {} }, name: 'qiankun-name' });
  assert.equal(t.mounts, 1);
  assert.equal(t.root.dataset.theme, 'light');
  await t.lifecycle.unmount();
  assert.equal(t.disposals, 1);
  assert.equal(t.host.listeners.size, 0);
});

test('route/theme updates preserve the chat; renewed authorization closes the old session', async () => {
  const t = setup();
  await t.lifecycle.mount({ container: t.container, platform: t.props });
  await t.lifecycle.update({ platform: { ...t.props, theme: 'dark', routePath: '/micro/websocket-chat/room' } });
  assert.equal(t.mounts, 1);
  assert.equal(t.disposals, 0);
  assert.equal(t.root.dataset.theme, 'dark');
  const next = trackedSignal();
  await t.lifecycle.update({ platform: { ...t.props, contextEpoch: 2, token: 'renewed-token', signal: next.signal } });
  assert.equal(t.disposals, 1);
  assert.equal(t.mounts, 2);
  assert.equal(t.host.listeners.size, 0);
  t.host.controller.abort();
  assert.equal(t.disposals, 1, 'old host signal must not revoke the replacement session');
  next.controller.abort();
  assert.equal(t.disposals, 2);
  assert.match(t.root.textContent, /上下文已失效/);
  await t.lifecycle.unmount();
  await t.lifecycle.unmount();
  assert.equal(next.listeners.size, 0);
  assert.equal(t.root.textContent, '');
});

test('both context and token expiry dispose the chat without another host update', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  try {
    for (const field of ['expiresAt', 'tokenExpiresAt']) {
      const t = setup();
      await t.lifecycle.mount({ container: t.container, platform: { ...t.props, [field]: new Date(Date.now() + 1000).toISOString() } });
      context.mock.timers.tick(999);
      assert.equal(t.disposals, 0);
      context.mock.timers.tick(1);
      assert.equal(t.disposals, 1);
      assert.match(t.root.textContent, /上下文已失效/);
      assert.equal(t.host.listeners.size, 0);
      await t.lifecycle.unmount();
    }
  } finally { context.mock.timers.reset(); }
});

test('invalid and already revoked updates fail closed and fresh context can remount', async () => {
  const t = setup();
  await t.lifecycle.mount({ container: t.container, platform: t.props });
  await assert.rejects(t.lifecycle.update({ platform: { ...t.props, expiresAt: 'invalid' } }), /props.platform/);
  assert.equal(t.disposals, 1);
  assert.equal(t.host.listeners.size, 0);
  t.host.controller.abort();
  await assert.rejects(t.lifecycle.update({ platform: t.props }), /revoked/);
  assert.equal(t.mounts, 1);
  const next = trackedSignal();
  await t.lifecycle.update({ platform: { ...t.props, signal: next.signal, contextEpoch: 2 } });
  assert.equal(t.mounts, 2);
  await assert.rejects(t.lifecycle.update(t.props), /props.platform/);
  assert.equal(t.disposals, 2);
  assert.equal(next.listeners.size, 0);
  await t.lifecycle.unmount();
});
