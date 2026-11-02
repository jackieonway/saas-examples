import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';

async function fillSources(f) {
  for (let index = 0; index < f.config.maxEntries * 4; index += 1) {
    const result = await f.backchannel(await f.logoutToken({ sid: `owned-unknown-source-${index}` }));
    assert.equal(result.status, 200, 'SOURCE_FIXTURE_MUST_REACH_THE_CONFIGURED_BOUND');
  }
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert(Date.now() < deadline, 'CAPACITY_FIXTURE_WAIT_TIMED_OUT'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function fillReceipts(f) {
  let first;
  for (let index = 0; index < f.config.maxEntries * 20; index += 1) {
    const token = await f.logoutToken({ sid: 'owned-repeated-unknown-source' }); first ??= token;
    assert.equal((await f.backchannel(token)).status, 200, 'REPLAY_FIXTURE_MUST_REACH_THE_CONFIGURED_BOUND');
  }
  return first;
}

for (const scope of ['CURRENT_APP', 'GLOBAL']) {
  test(`source ledger capacity cannot leave an authenticated session after ${scope} logout fails`, async () => {
    const f = await fixture({ maxEntries: 1 });
    try {
      const browser = f.browser(); assert.equal((await browser.login()).response.status, 303);
      await fillSources(f);
      const result = await browser.call('/auth/logout', 'POST', { scope });
      assert.equal(result.status, 503); assert.equal(result.json().code, 'SOURCE_CAPACITY');
      const session = (await browser.call('/api/session')).json();
      assert.equal(session.authenticated, false, 'CAPACITY_FAILURE_MUST_CLOSE_LOCAL_AUTHENTICATION');
      assert.equal(session.pendingLogout, true, 'ORIGINAL_OPERATION_MUST_REMAIN_RECOVERABLE');
      assert.equal((await browser.call('/api/userinfo')).status, 401);
      assert.equal(f.controls.logoutCount, 0);
      const recovered = await browser.call('/auth/logout/recover', 'POST', {});
      assert.equal(recovered.status, 200); assert.equal(recovered.json().scope, scope);
      assert.equal(f.controls.logoutCount, 1); assert.equal(f.controls.recoverCount, 1);
      assert.deepEqual(f.controls.logoutOperationIds, f.controls.recoverOperationIds, 'RECOVERY_MUST_USE_THE_ORIGINAL_OPERATION');
      assert.equal((await browser.call('/api/session')).json().authenticated, false);
    } finally { await f.close(); }
  });
}

for (const operation of ['logout', 'revoke']) {
  test(`source capacity closes every local session of the original source before ${operation} returns`, async () => {
    const f = await fixture({ maxEntries: 2 });
    try {
      const first = f.browser(), second = f.browser();
      assert.equal((await first.login()).response.status, 303); assert.equal((await second.login()).response.status, 303);
      await fillSources(f); const userInfoBefore = f.controls.userInfoCount;
      const result = await first.call(`/auth/${operation}`, 'POST', operation === 'logout' ? { scope: 'CURRENT_APP' } : {});
      assert.equal(result.status, 503); assert.equal(result.json().code, 'SOURCE_CAPACITY');
      for (const browser of [first, second]) {
        assert.equal((await browser.call('/api/session')).json().authenticated, false);
        assert.equal((await browser.call('/api/userinfo')).status, 401);
        assert.equal((await browser.call('/auth/refresh', 'POST', {})).status, 401);
      }
      assert.equal(f.controls.userInfoCount, userInfoBefore, 'CLOSED_SESSIONS_MUST_NOT_SEND_OLD_BEARERS');
      assert.equal(f.controls.revokeCount, 0); assert.equal(f.controls.logoutCount, 0);
    } finally { await f.close(); }
  });
}

test('source-full signed logout closes the exact local source without acknowledging or evicting earlier facts', async () => {
  const f = await fixture({ maxEntries: 2 });
  try {
    const firstSid = f.controls.sid, first = f.browser(); await first.login();
    f.controls.sid = 'other-owned-source'; const other = f.browser(); await other.login();
    await fillSources(f);
    const token = await f.logoutToken({ sid: firstSid }); const rejected = await f.backchannel(token);
    assert.equal(rejected.status, 503); assert.equal(rejected.json().code, 'SOURCE_CAPACITY');
    assert.equal((await first.call('/api/session')).json().authenticated, false);
    assert.equal((await first.call('/api/userinfo')).status, 401);
    assert.equal((await other.call('/api/session')).json().authenticated, true);
    assert.equal((await other.call('/api/userinfo')).status, 200);
    assert.equal((await other.call('/auth/refresh', 'POST', {})).status, 200);
    // A new jti for an existing fact still fits; no old tombstone was evicted.
    assert.equal((await f.backchannel(await f.logoutToken({ sid: 'owned-unknown-source-0' }))).status, 200);
  } finally { await f.close(); }
});

test('replay ledger capacity closes the signed original source before returning a non-acknowledgement', async () => {
  const f = await fixture({ maxEntries: 2 });
  try {
    const firstSid = f.controls.sid, first = f.browser(); await first.login();
    f.controls.sid = 'other-owned-source'; const other = f.browser(); await other.login();
    const firstReceipt = await fillReceipts(f);
    const result = await f.backchannel(await f.logoutToken({ sid: firstSid }));
    assert.equal(result.status, 503); assert.equal(result.json().code, 'REPLAY_CAPACITY');
    assert.equal((await first.call('/api/session')).json().authenticated, false);
    assert.equal((await first.call('/api/userinfo')).status, 401);
    assert.equal((await other.call('/api/session')).json().authenticated, true);
    assert.equal((await other.call('/api/userinfo')).status, 200);
    assert.equal((await f.backchannel(firstReceipt)).status, 409, 'EARLIER_REPLAY_FACTS_MUST_NOT_BE_EVICTED');
  } finally { await f.close(); }
});

for (const capacity of ['source', 'replay']) {
  test(`${capacity} capacity cannot resurrect an unknown source through a callback already waiting at UserInfo`, async () => {
    const f = await fixture({ maxEntries: 2 }); let release, work;
    try {
      const other = f.browser(); await other.login(); const browser = f.browser(); await browser.call('/api/session');
      if (capacity === 'source') await fillSources(f); else await fillReceipts(f);
      f.controls.sid = 'owned-pending-callback-source'; const before = f.controls.userInfoCount;
      f.controls.userInfoBarrier = new Promise(resolve => { release = resolve; }); work = browser.callback();
      await until(() => f.controls.userInfoCount > before);
      const notification = await f.backchannel(await f.logoutToken());
      assert.equal(notification.status, 503); assert.equal(notification.json().code, capacity === 'source' ? 'SOURCE_CAPACITY' : 'REPLAY_CAPACITY');
      release(); const callback = (await work).response;
      assert.equal(callback.status, capacity === 'source' ? 503 : 401);
      assert.equal((await browser.call('/api/session')).json().authenticated, false);
      assert.equal((await other.call('/api/session')).json().authenticated, true);
      assert.equal((await other.call('/api/userinfo')).status, 200);
    } finally { release?.(); await work?.catch(() => {}); await f.close(); }
  });
}

test('source-full notification wins against a refresh already awaiting its rotated token', async () => {
  const f = await fixture({ maxEntries: 2 }); let release, work;
  try {
    const first = f.browser(), second = f.browser(); await first.login(); await second.login(); await fillSources(f);
    f.controls.refreshBarrier = new Promise(resolve => { release = resolve; }); work = first.call('/auth/refresh', 'POST', {});
    await until(() => f.controls.refreshCount === 1);
    const notification = await f.backchannel(await f.logoutToken()); assert.equal(notification.status, 503);
    release(); assert.equal((await work).status, 401);
    assert.equal((await first.call('/api/session')).json().authenticated, false);
    assert.equal((await second.call('/api/session')).json().authenticated, false);
    assert.equal((await second.call('/api/userinfo')).status, 401);
  } finally { release?.(); await work?.catch(() => {}); await f.close(); }
});

test('closing a known original source fences a newer code result waiting in that same browser session', async () => {
  const f = await fixture({ maxEntries: 1 }); let release, work;
  try {
    const originalSid = f.controls.sid, browser = f.browser(); await browser.login();
    f.controls.sid = 'new-code-source-in-old-local-session'; const before = f.controls.userInfoCount;
    f.controls.userInfoBarrier = new Promise(resolve => { release = resolve; }); work = browser.callback();
    await until(() => f.controls.userInfoCount > before);
    assert.equal((await f.backchannel(await f.logoutToken({ sid: originalSid }))).status, 200);
    release(); assert.equal((await work).response.status, 401);
    assert.equal((await browser.call('/api/session')).json().authenticated, false);
  } finally { release?.(); await work?.catch(() => {}); await f.close(); }
});

test('a mismatched signed subject at source capacity cannot close or quarantine an unrelated source', async () => {
  const f = await fixture({ maxEntries: 1 });
  try {
    const browser = f.browser(); await browser.login(); await fillSources(f);
    assert.equal((await f.backchannel(await f.logoutToken({ sub: 'not-the-local-subject' }))).status, 400);
    assert.equal((await browser.call('/api/session')).json().authenticated, true);
    assert.equal((await browser.call('/api/userinfo')).status, 200);
    f.controls.sid = 'explicit-new-login-after-invalid-notification';
    assert.equal((await browser.callback()).response.status, 303);
  } finally { await f.close(); }
});
