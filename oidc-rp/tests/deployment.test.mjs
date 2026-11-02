import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadMachineConfig } from '../src/config.mjs';
import { secureFetch } from '../src/transport.mjs';
import { fixture, listen, tls } from './support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function privateFiles() {
  const tempRoot = path.resolve(os.tmpdir()), directory = mkdtempSync(path.join(tempRoot, 'oidc-rp-test-'));
  const secret = path.join(directory, 'client.secret'), cert = path.join(directory, 'ca.pem');
  writeFileSync(secret, 'fixture-only-secret', { mode: 0o600 }); writeFileSync(cert, tls.cert, { mode: 0o600 });
  return { secret, cert, close() {
    const checked = path.resolve(directory); assert.equal(path.dirname(checked), tempRoot); assert(path.basename(checked).startsWith('oidc-rp-test-'));
    rmSync(checked, { recursive: true, force: true });
  } };
}
function runMachine(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['machine.mjs'], { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
    child.stdout.on('data', value => { stdout += value; if (stdout.length > 10000) child.kill(); });
    child.stderr.on('data', value => { stderr += value; if (stderr.length > 10000) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (timedOut) reject(new Error('MACHINE_TIMEOUT')); else resolve({ code, stdout, stderr }); });
  });
}

test('deployment requires exact HTTPS origins, file-injected secrets, bounded sessions and an opaque client ID', () => {
  const files = privateFiles();
  try {
    const values = { RP_ORIGIN: 'https://rp.example.test', OIDC_ISSUER: 'https://auth.example.test', OIDC_CLIENT_ID: 'opaque|client-not-uuid', OIDC_CLIENT_SECRET_FILE: files.secret };
    const config = loadConfig(values); assert.equal(config.clientId, values.OIDC_CLIENT_ID); assert.equal(config.sessionSeconds, 300);
    for (const replacement of [{ RP_ORIGIN: 'http://127.0.0.1:3012' }, { OIDC_ISSUER: 'https://auth.example.test/' },
      { OIDC_CLIENT_SECRET_FILE: path.join(path.dirname(files.secret), 'missing') }, { RP_SESSION_SECONDS: '301' },
      { OIDC_SCOPES: 'openid profile email' }, { OIDC_SCOPES: 'openid openid' }, { RP_TLS_CERT_FILE: files.cert }]) assert.throws(() => loadConfig({ ...values, ...replacement }));
  } finally { files.close(); }
});

test('HTTPS transport rejects missing trust, a different origin, private paths and redirects', async () => {
  const server = await listen((request, response) => { response.writeHead(302, { Location: 'https://attacker.example' }); response.end(); });
  try {
    await assert.rejects(secureFetch({ origin: server.origin })(server.origin));
    const trusted = secureFetch({ origin: server.origin, ca: tls.cert });
    await assert.rejects(trusted('https://other.example/'));
    await assert.rejects(trusted(`${server.origin}/internal/identity/anything`));
    await assert.rejects(trusted(server.origin));
  } finally { await server.close(); }
});

test('HTTPS transport sets UTF8 byte Content-Length and rejects caller framing conflicts', async () => {
  const seen = [];
  const server = await listen(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    seen.push({ length: request.headers['content-length'], transfer: request.headers['transfer-encoding'], bytes: Buffer.concat(chunks).length });
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}');
  });
  try {
    const request = secureFetch({ origin: server.origin, ca: tls.cert });
    await request(server.origin, { method: 'POST', body: '字段=中文' });
    await request(server.origin, { method: 'POST', body: new URLSearchParams({ code: 'opaque-value' }) });
    assert.equal(seen[0].length, String(Buffer.byteLength('字段=中文'))); assert.equal(seen[0].length, String(seen[0].bytes));
    assert.equal(seen[0].transfer, undefined); assert.equal(seen[1].length, String(seen[1].bytes));
    await assert.rejects(request(server.origin, { method: 'POST', headers: { 'Content-Length': '1' }, body: 'longer' }));
    await assert.rejects(request(server.origin, { method: 'POST', headers: { 'Transfer-Encoding': 'chunked' }, body: 'value' }));
    assert.equal(seen.length, 2);
  } finally { await server.close(); }
});

test('machine CLI uses the same standard library, separate confidential config and approved resource without leaking credentials', async () => {
  const f = await fixture(), files = privateFiles();
  try {
    const env = { MACHINE_ISSUER: f.op.origin, MACHINE_CLIENT_ID: 'external-rp-client', MACHINE_CLIENT_SECRET_FILE: files.secret,
      MACHINE_SCOPE: 'demo.read', MACHINE_RESOURCE_URL: `${f.op.origin}/resource`, NODE_EXTRA_CA_CERTS: files.cert };
    const result = await runMachine(env); assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout); assert.equal(summary.state, 'MACHINE_TOKEN_OBTAINED'); assert.equal(summary.resourceStatus, 200); assert.equal(summary.scope, 'demo.read');
    assert(!/opaque-access|fixture-only-secret|id_token|refresh_token/.test(result.stdout));
    const rejected = await runMachine({ ...env, MACHINE_SCOPE: 'demo.admin' }); assert.equal(rejected.code, 1); assert.equal(rejected.stdout, ''); assert.equal(rejected.stderr.trim(), 'MACHINE_REQUEST_REJECTED');
    assert.throws(() => loadMachineConfig({ ...env, MACHINE_SCOPE: 'openid' }));
  } finally { files.close(); await f.close(); }
});
