import assert from 'node:assert/strict';
import { launchBrowser } from './browser-runtime.mjs';
import { build, preview } from 'vite';
import { SDK_VERSION } from '../vendor/micro-app-sdk/2.0.0/index.mjs';

async function waitUntil(condition, description) {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(condition(), description);
}

const previousEndpoint = process.env.VITE_CHAT_ENDPOINT;
process.env.VITE_CHAT_ENDPOINT = 'https://chat.example.invalid';
const bindHost = process.platform === 'win32' ? '::1' : '127.0.0.1';
await build({ logLevel: 'error' });
const dev = await preview({ preview: { host: bindHost, port: 0 }, logLevel: 'error' });
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  const events = [];
  let connections = 0;
  let closed = 0;
  let messageId = 0;
  const message = (username, content, type) => ({
    id: `message-${++messageId}`, username, content, type, timestamp: '2026-10-15T00:00:00.000Z',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/chat\.example\.invalid/, (socket) => {
    connections++;
    let connectionClosed = false;
    socket.onClose(() => { if (!connectionClosed) { connectionClosed = true; closed++; } });
    const user = { id: `user-${connections}`, username: '' };
    socket.onMessage((packet) => {
      if (packet === '40') socket.send(`40${JSON.stringify({ sid: user.id })}`);
      if (!String(packet).startsWith('42')) return;
      const [event, payload] = JSON.parse(String(packet).slice(2));
      events.push({ event, payload });
      if (event === 'join') {
        user.username = payload.username;
        socket.send(`42${JSON.stringify(['user-joined', { user, message: message('System', 'Joined controlled chat', 'system') }])}`);
        socket.send(`42${JSON.stringify(['users-list', { users: [user] }])}`);
      }
      if (event === 'message') socket.send(`42${JSON.stringify(['message', message(user.username, payload.content, 'user')])}`);
    });
    socket.send(`0${JSON.stringify({ sid: `transport-${connections}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`);
  });
  await page.goto(`http://${bindHost.includes(':') ? `[${bindHost}]` : bindHost}:${dev.httpServer.address().port}/`);
  await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
  assert.equal(connections, 0, 'page mounting must not connect to the configured endpoint');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Username' }).fill('  Alice  ');
  await page.getByRole('button', { name: 'Join Chat' }).click();
  await page.getByText('Online users: 1').waitFor();
  await page.getByRole('textbox', { name: 'Message' }).fill('  Controlled hello  ');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.getByText('Controlled hello', { exact: true }).waitFor();
  assert.deepEqual(events, [
    { event: 'join', payload: { username: 'Alice' } },
    { event: 'message', payload: { content: 'Controlled hello', username: 'Alice' } },
  ]);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByText('Disconnected', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Username' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Join Chat' }).click();
  await page.getByText('Online users: 1').waitFor();
  assert.equal(connections, 2);
  assert.equal(events.filter(({ event }) => event === 'join').length, 2);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByText('Disconnected', { exact: true }).waitFor();
  await waitUntil(() => closed === connections, `explicit disconnect closes standalone sockets (${closed}/${connections})`);

  // Load the same production UMD with qiankun ownership, never the old bridge.
  await page.addInitScript(() => { window.__POWERED_BY_QIANKUN__ = true; });
  await page.reload();
  assert.equal(await page.getByRole('heading', { name: /WebSocket Demo/ }).count(), 0);
  await page.evaluate(async sdkVersion => {
    const lifecycle = window['websocket-chat'];
    if (Object.keys(lifecycle).sort().join(',') !== 'bootstrap,mount,unmount,update') throw new Error('Unexpected lifecycle exports');
    if (window.MicroIframe || window.__MICRO_APP__) throw new Error('Legacy host channel was installed');
    const controller = new AbortController();
    const platform = {
      sdkVersion, contractVersion: '2.0', appCode: 'websocket-chat', token: 'application-token',
      contextVersion: 'context-1', contextEpoch: 1,
      expiresAt: new Date(Date.now() + 30000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
      basePath: '/micro/websocket-chat', routePath: '/micro/websocket-chat', theme: 'light',
      user: { id: 'user', username: 'alice', displayName: 'Alice' }, tenant: { id: 'tenant', code: 'tenant', name: 'Tenant' },
      organization: { id: 'org-1', name: 'Organization', path: '/org' }, organizationScopeIds: ['org-1'],
      roles: [], permissions: [], dataGrants: [], menus: [], signal: controller.signal, onNavigate() {}, onNotify() {},
    };
    const root = document.querySelector('#root');
    const container = document.createElement('div');
    root.replaceWith(container);
    container.append(root);
    await lifecycle.bootstrap();
    try { await lifecycle.mount({ ...platform, container }); throw new Error('Direct props were accepted'); }
    catch (error) { if (!String(error).includes('props.platform')) throw error; }
    await lifecycle.mount({ name: 'websocket-chat', container, platform, services: {} });
    window.__CHAT_TEST__ = { lifecycle, controller, platform, container };
  }, SDK_VERSION);
  const initialConnections = connections;
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Username' }).fill('Platform Alice');
  await page.getByRole('button', { name: 'Join Chat' }).click();
  await page.getByText('Online users: 1').waitFor();
  await page.evaluate(async () => {
    const test = window.__CHAT_TEST__;
    test.platform = { ...test.platform, theme: 'dark', routePath: '/micro/websocket-chat/room' };
    await test.lifecycle.update({ platform: test.platform });
  });
  assert.equal(connections, initialConnections + 1, 'display update keeps the connected session');
  await page.getByText('Online users: 1').waitFor();
  assert.equal(await page.locator('#root').getAttribute('data-theme'), 'dark');

  await page.evaluate(async () => {
    const test = window.__CHAT_TEST__;
    test.platform = { ...test.platform, contextEpoch: 2, token: 'renewed-token', organization: { id: 'org-2', name: 'Next', path: '/next' } };
    await test.lifecycle.update({ platform: test.platform });
  });
  await waitUntil(() => closed === connections, 'authorization change disconnects the previous chat');
  assert.equal(await page.getByRole('textbox', { name: 'Username' }).inputValue(), '');
  assert.equal(connections, initialConnections + 1, 'authorization change does not reconnect automatically');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.evaluate(() => window.__CHAT_TEST__.controller.abort());
  await waitUntil(() => closed === connections, 'host abort disconnects the chat');
  await page.getByText('应用上下文已失效，请等待平台重新授权。', { exact: true }).waitFor();

  await page.clock.install();
  await page.evaluate(async () => {
    const test = window.__CHAT_TEST__;
    test.controller = new AbortController();
    test.platform = { ...test.platform, contextEpoch: 3, signal: test.controller.signal,
      expiresAt: new Date(Date.now() + 1000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString() };
    await test.lifecycle.update({ platform: test.platform });
  });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.clock.fastForward(1001);
  await waitUntil(() => closed === connections, 'context expiry disconnects the chat');
  await page.getByText('应用上下文已失效，请等待平台重新授权。', { exact: true }).waitFor();
  await page.evaluate(async () => {
    const test = window.__CHAT_TEST__;
    test.platform = { ...test.platform, contextEpoch: 4,
      expiresAt: new Date(Date.now() + 60000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString() };
    await test.lifecycle.update({ platform: test.platform });
  });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.evaluate(async () => { await window.__CHAT_TEST__.lifecycle.unmount(); await window.__CHAT_TEST__.lifecycle.unmount(); });
  await waitUntil(() => closed === connections, 'qiankun unmount disconnects the chat');
  const finalConnections = connections;
  await page.clock.fastForward(30000);
  assert.equal(connections, finalConnections, 'unmounted sockets have no reconnect work');
  assert.equal(await page.locator('#root').textContent(), '');
  assert.deepEqual(errors, []);
  console.log(`PASS: browser ${await browser.version()}; standalone connect/join/message/rejoin; standard qiankun UMD, nested context, display update, authorization replacement, abort, expiry and unmount close sockets; no reconnect after disposal; no page errors; all chat transport intercepted.`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => dev.httpServer.close(error => error ? reject(error) : resolve()));
  if (previousEndpoint === undefined) delete process.env.VITE_CHAT_ENDPOINT;
  else process.env.VITE_CHAT_ENDPOINT = previousEndpoint;
}
