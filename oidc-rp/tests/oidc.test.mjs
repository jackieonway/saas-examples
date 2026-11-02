import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';

async function using(run) { const value = await fixture(); try { await run(value); } finally { await value.close(); } }
function clean(value) { assert(!/opaque-access|opaque-refresh|NEVER_RETURN_THIS_TOKEN|fixture-only-secret|id_token|code_verifier/.test(value)); }
async function until(predicate) { const end = Date.now() + 3000; while (!predicate()) { assert(Date.now() < end, 'FIXTURE_WAIT_TIMED_OUT'); await new Promise(resolve => setTimeout(resolve, 5)); } }

test('real HTTPS standard discovery, Basic, S256, signed ID Token and matching opaque UserInfo establish a separate session', () => using(async f => {
  const browser = f.browser(); const { response, authorizationUrl, callbackUrl } = await browser.login();
  assert.equal(response.status, 303); assert.equal(response.headers.location, '/');
  assert.match(response.headers['set-cookie'][0], /^__Host-oidc_rp=.*; Secure; HttpOnly; SameSite=Lax; Path=\//);
  const authorize = new URL(authorizationUrl); assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert(authorize.searchParams.get('nonce')); assert(authorize.searchParams.get('state'));
  const session = (await browser.call('/api/session')).json(); assert.equal(session.authenticated, true);
  assert.equal(session.identity.subject, 'pairwise|opaque-user-without-uuid'); assert.equal(session.identity.issuer, f.op.origin);
  assert.equal(session.hasRefreshToken, true); assert(!session.identity.email); clean(JSON.stringify(session));
  assert.equal((await browser.call(callbackUrl.pathname + callbackUrl.search)).status, 400);
  assert.equal(f.controls.tokenCount, 1);
  const info = await browser.call('/api/userinfo'); assert.equal(info.status, 200); clean(info.text);
  assert.equal((await browser.call('/api/account/link', 'POST', { email: 'same@example.test' })).json().code, 'EXPLICIT_DUAL_CONTROL_LINK_REQUIRED');
  assert.equal(f.controls.requestLengthFailures, 0);
}));

test('an opaque nonhex and nonUUID sid remains stable through callback, refresh and signed logout', () => using(async f => {
  f.controls.sid = 'provider-specific|sid/opaque-01';
  const browser = f.browser(); assert.equal((await browser.login()).response.status, 303);
  assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 200);
  assert.equal((await f.backchannel(await f.logoutToken())).status, 200);
  assert.equal((await browser.call('/api/session')).json().authenticated, false);
}));

for (const kind of ['state', 'issuer', 'nonce', 'pkce', 'signature', 'userinfo']) {
  test(`standard client rejects actual HTTPS ${kind} failure without creating a session or disclosing upstream material`, () => using(async f => {
    if (kind === 'nonce') f.controls.invalidNonce = true;
    if (kind === 'pkce') f.controls.codeVerifierFailure = true;
    if (kind === 'signature') f.controls.badSignature = true;
    if (kind === 'userinfo') f.controls.userInfoSubject = 'another-user';
    const browser = f.browser(); await browser.call('/api/session');
    const { response } = await browser.callback(url => {
      if (kind === 'state') url.searchParams.set('state', 'wrong-state');
      if (kind === 'issuer') url.searchParams.set('iss', 'https://other-issuer.example');
    });
    assert.equal(response.status, 400); clean(response.text);
    assert.equal((await browser.call('/api/session')).json().authenticated, false);
  }));
}

test('Origin/CSRF, duplicate callback, unapproved field and fixed-host checks reject before a token exchange', () => using(async f => {
  const browser = f.browser(); await browser.call('/api/session');
  assert.equal((await browser.call('/auth/login', 'POST', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await browser.call('/auth/login', 'POST', {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await browser.call('/auth/login', 'POST', { scope: 'admin' })).status, 400);
  const { response } = await browser.callback(url => url.searchParams.append('state', 'duplicate'));
  assert.equal(response.status, 400); assert.equal(f.controls.tokenCount, 0);
  const direct = await f.request(`${f.rp.origin}/api/session`, { headers: { Host: 'attacker.example' } }); assert.equal(direct.status, 400);
}));

test('refresh rotates once, keeps the original opaque identity, and failure closes the local session', () => using(async f => {
  const browser = f.browser(); await browser.login(); const before = (await browser.call('/api/session')).json();
  const refreshed = await browser.call('/auth/refresh', 'POST', {}); assert.equal(refreshed.status, 200);
  const after = (await browser.call('/api/session')).json(); assert.equal(after.identity.subject, before.identity.subject); assert.equal(after.expiresAt, before.expiresAt);
  f.controls.refreshFailure = true;
  const failed = await browser.call('/auth/refresh', 'POST', {}); assert.equal(failed.status, 400); clean(failed.text);
  assert.equal((await browser.call('/api/session')).json().authenticated, false); assert.equal(f.controls.refreshCount, 2);
  assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 401); assert.equal(f.controls.refreshCount, 2);
}));

test('missing ID Token cannot establish login even when the access token and UserInfo are valid', () => using(async f => {
  f.controls.omitIdToken = true; const browser = f.browser();
  assert.equal((await browser.login()).response.status, 400);
  assert.equal((await browser.call('/api/session')).json().authenticated, false);
}));

test('refresh without an ID Token retains the original verified subject and sid', () => using(async f => {
  const browser = f.browser(); await browser.login(); f.controls.omitRefreshIdToken = true;
  const original = (await browser.call('/api/session')).json();
  assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 200);
  assert.equal((await browser.call('/api/session')).json().identity.subject, original.identity.subject);
}));

test('a changed public sid on refresh closes the session instead of adopting a new source', () => using(async f => {
  const browser = f.browser(); await browser.login(); f.controls.sid = 'c'.repeat(64);
  assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 401);
  assert.equal((await browser.call('/api/session')).json().authenticated, false);
}));

test('a callback waiting at UserInfo cannot establish an already expired local session', async () => {
  const f = await fixture({ sessionSeconds: 1 }); let release;
  try {
    const browser = f.browser(); await browser.call('/api/session');
    f.controls.userInfoBarrier = new Promise(resolve => { release = resolve; }); const callback = browser.callback();
    await until(() => f.controls.tokenCount); await new Promise(resolve => setTimeout(resolve, 1100)); release();
    assert.equal((await callback).response.status, 401);
    assert.equal((await browser.call('/api/session')).json().authenticated, false);
  } finally { release?.(); await f.close(); }
});

test('a concurrent refresh cannot spend the same rotating token twice', () => using(async f => {
  const browser = f.browser(); await browser.login(); let release;
  f.controls.refreshBarrier = new Promise(resolve => { release = resolve; });
  const first = browser.call('/auth/refresh', 'POST', {});
  await until(() => f.controls.refreshCount);
  assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 409);
  release(); assert.equal((await first).status, 200); assert.equal(f.controls.refreshCount, 1);
}));

test('RFC7009 revokes the refresh family and access token and leaves an anonymous local cookie', () => using(async f => {
  const browser = f.browser(); await browser.login();
  assert.equal((await browser.call('/auth/revoke', 'POST', {})).status, 200); assert.equal(f.controls.revokeCount, 2);
  assert.equal((await browser.call('/api/session')).json().authenticated, false);
  assert.equal((await browser.call('/api/userinfo')).status, 401);
}));

test('unknown RP logout result queries the original operation and never creates a new command', () => using(async f => {
  const browser = f.browser(); await browser.login(); f.controls.unknownLogout = true;
  const result = await browser.call('/auth/logout', 'POST', { scope: 'CURRENT_APP' }); assert.equal(result.status, 503);
  let session = (await browser.call('/api/session')).json(); assert.equal(session.authenticated, false); assert.equal(session.pendingLogout, true);
  assert.equal((await browser.call('/auth/login', 'POST', {})).status, 409);
  const recovered = await browser.call('/auth/logout/recover', 'POST', {}); assert.equal(recovered.status, 200);
  assert.equal(recovered.json().scope, 'CURRENT_APP'); assert.equal(f.controls.logoutCount, 1); assert.equal(f.controls.recoverCount, 1);
  session = (await browser.call('/api/session')).json(); assert.equal(session.pendingLogout, false);
}));

test('valid signed backchannel closes only the exact sid/sub, rejects replay and cannot revive through refresh', () => using(async f => {
  const first = f.browser(); await first.login(); f.controls.sid = 'b'.repeat(64); const other = f.browser(); await other.login();
  const token = await f.logoutToken({ sid: 'a'.repeat(64) });
  assert.equal((await f.backchannel(token)).status, 200); assert.equal((await f.backchannel(token)).status, 409);
  assert.equal((await first.call('/api/session')).json().authenticated, false);
  assert.equal((await other.call('/api/session')).json().authenticated, true);
  assert.equal((await first.call('/auth/refresh', 'POST', {})).status, 401);
}));

test('signed unknown-sid tombstone blocks a late callback while UserInfo is waiting', () => using(async f => {
  const browser = f.browser(); await browser.call('/api/session'); let release;
  f.controls.userInfoBarrier = new Promise(resolve => { release = resolve; });
  const callback = browser.callback();
  await until(() => f.controls.tokenCount);
  const result = await f.backchannel(await f.logoutToken()); assert.equal(result.status, 200); assert.equal(result.json().closedSessions, 0);
  release(); assert.equal((await callback).response.status, 401);
  assert.equal((await browser.call('/api/session')).json().authenticated, false);
}));

test('signed backchannel racing refresh wins before the result can reattach the original source', () => using(async f => {
  const browser = f.browser(); await browser.login(); let release;
  f.controls.refreshBarrier = new Promise(resolve => { release = resolve; }); const refreshed = browser.call('/auth/refresh', 'POST', {});
  await until(() => f.controls.refreshCount);
  assert.equal((await f.backchannel(await f.logoutToken())).status, 200); release();
  assert.equal((await refreshed).status, 401); assert.equal((await browser.call('/api/session')).json().authenticated, false);
}));

for (const kind of ['audience', 'issuer', 'signature', 'nonce', 'event', 'eventBoolean', 'expired', 'mismatch', 'header', 'oversizedSid', 'controlSid']) {
  test(`backchannel rejects ${kind} and preserves the unrelated authenticated session`, () => using(async f => {
    const browser = f.browser(); await browser.login(); const now = Math.floor(Date.now() / 1000);
    const changes = { audience: { aud: 'wrong-client' }, issuer: { iss: 'https://wrong.example' }, nonce: { nonce: 'forbidden' },
      event: { events: { wrong: {} } }, eventBoolean: { events: { 'http://schemas.openid.net/event/backchannel-logout': true } },
      expired: { iat: now - 121, exp: now - 1 }, mismatch: { sub: 'wrong-subject' },
      oversizedSid: { sid: 'x'.repeat(257) }, controlSid: { sid: 'forbidden\nsid' } };
    const token = await f.logoutToken(changes[kind] ?? {}, kind === 'header' ? { jku: 'https://attacker.example/jwks' } : {}, kind === 'signature');
    assert.equal((await f.backchannel(token)).status, 400);
    assert.equal((await browser.call('/api/session')).json().authenticated, true);
  }));
}
