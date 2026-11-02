import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { secureFetch } from '../src/transport.mjs';
import { discover, uuidV7 } from '../src/oidc.mjs';
import { createApplication } from '../src/app.mjs';

// No container or database. The ephemeral test CA is generated and removed in
// one process; the HTTPS peers still validate their exact hostname and CA.
const certificateScript = `set -eu
tmp=$(mktemp -d /tmp/oidc-rp-cert.XXXXXX)
trap 'case "$tmp" in /tmp/oidc-rp-cert.*) rm -rf -- "$tmp" ;; esac' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/key" -out "$tmp/cert" -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 >/dev/null 2>&1
python3 -c 'import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); print(json.dumps({"key":(p/"key").read_text(),"cert":(p/"cert").read_text()}))' "$tmp"
`;
export const tls = JSON.parse(execFileSync(process.platform === 'win32' ? 'wsl.exe' : 'sh',
  process.platform === 'win32' ? ['-u', 'root', '--', 'sh'] : [],
  { input: certificateScript, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 20000 }));

export async function listen(handler) {
  const server = https.createServer(tls, handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `https://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
function reply(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
async function form(request) { let body = ''; for await (const chunk of request) body += chunk; return new URLSearchParams(body); }
const pkce = value => createHash('sha256').update(value).digest('base64url');

export async function fixture(options = {}) {
  const keys = await generateKeyPair('RS256'), wrongKeys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-signing-key', alg: 'RS256', use: 'sig' };
  const controls = { tokenCount: 0, userInfoCount: 0, refreshCount: 0, revokeCount: 0, logoutCount: 0, recoverCount: 0,
    subject: 'pairwise|opaque-user-without-uuid', sid: 'a'.repeat(64), invalidNonce: false,
    codeVerifierFailure: false, badSignature: false, claims: {}, userInfoSubject: undefined, refreshFailure: false,
    userInfoBarrier: undefined, refreshBarrier: undefined, unknownLogout: false, omitIdToken: false, requestLengthFailures: 0,
    omitRefreshIdToken: false, refreshSubject: undefined, logoutReceipts: new Map(), logoutOperationIds: [], recoverOperationIds: [] };
  const codes = new Map(), access = new Map(), refreshes = new Map(); let op;
  const issue = async (authorization, machine = false) => {
    const accessToken = `opaque-access-${uuidV7()}`, refreshToken = `opaque-refresh-${uuidV7()}`;
    access.set(accessToken, { machine, subject: controls.subject });
    const result = { access_token: accessToken, token_type: 'Bearer', expires_in: 120, scope: machine ? 'demo.read' : 'openid profile' };
    if (!machine) {
      refreshes.set(refreshToken, authorization); result.refresh_token = refreshToken;
      result.id_token = await new SignJWT({ sid: controls.sid, auth_time: Math.floor(Date.now() / 1000),
        ...(authorization?.nonce ? { nonce: controls.invalidNonce ? 'unexpected-nonce' : authorization.nonce } : {}), ...controls.claims })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' }).setIssuer(op.origin).setAudience('external-rp-client')
        .setSubject(controls.subject).setIssuedAt().setExpirationTime('2m')
        .sign(controls.badSignature ? wrongKeys.privateKey : keys.privateKey);
      if (controls.omitIdToken || (!authorization?.nonce && controls.omitRefreshIdToken)) delete result.id_token;
    }
    return result;
  };
  op = await listen(async (request, response) => {
    try {
      const url = new URL(request.url, op.origin);
      if (request.method === 'POST' && (request.headers['transfer-encoding'] || !/^[0-9]+$/.test(request.headers['content-length'] ?? ''))) {
        controls.requestLengthFailures += 1;
        response.writeHead(400); response.end(); return;
      }
      if (url.pathname === '/.well-known/openid-configuration') return reply(response, 200, {
        issuer: op.origin, authorization_endpoint: `${op.origin}/authorize`, token_endpoint: `${op.origin}/token`,
        userinfo_endpoint: `${op.origin}/userinfo`, jwks_uri: `${op.origin}/jwks`, revocation_endpoint: `${op.origin}/revoke`,
        rp_logout_command_endpoint: `${op.origin}/logout`, response_types_supported: ['code'], response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'], subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true,
      });
      if (url.pathname === '/jwks') return reply(response, 200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
        const authorization = Object.fromEntries(url.searchParams), code = uuidV7(); codes.set(code, authorization);
        const callback = new URL(authorization.redirect_uri); callback.searchParams.set('code', code);
        callback.searchParams.set('state', authorization.state); callback.searchParams.set('iss', op.origin);
        response.writeHead(302, { Location: callback.href }); response.end(); return;
      }
      if (url.pathname === '/userinfo') {
        controls.userInfoCount += 1;
        if (controls.userInfoBarrier) await controls.userInfoBarrier;
        const token = access.get((request.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!token || token.machine) return reply(response, 401, { error: 'invalid_token' });
        return reply(response, 200, { sub: controls.userInfoSubject ?? token.subject, name: '独立示例账号', email: 'same@example.test' });
      }
      if (url.pathname === '/resource') {
        const token = access.get((request.headers.authorization ?? '').replace(/^Bearer /, ''));
        return reply(response, token?.machine ? 200 : 401, token?.machine ? { allowed: true } : { code: 'WRONG_AUDIENCE' });
      }
      const authorization = request.headers.authorization ?? '';
      let credentials;
      try { credentials = Buffer.from(authorization.slice(6), 'base64').toString().split(':').map(value => decodeURIComponent(value.replaceAll('+', ' '))); } catch { credentials = []; }
      if (!authorization.startsWith('Basic ') || credentials.length !== 2 || credentials[0] !== 'external-rp-client' || credentials[1] !== 'fixture-only-secret') return reply(response, 401, { error: 'invalid_client' });
      const data = await form(request);
      if (url.pathname === '/token') {
        controls.tokenCount += 1;
        if (data.get('grant_type') === 'client_credentials') {
          if (data.get('scope') !== 'demo.read') return reply(response, 400, { error: 'invalid_scope' });
          return reply(response, 200, await issue(undefined, true));
        }
        if (data.get('grant_type') === 'authorization_code') {
          const authorization = codes.get(data.get('code')); codes.delete(data.get('code'));
          if (!authorization || controls.codeVerifierFailure || pkce(data.get('code_verifier') ?? '') !== authorization.code_challenge || data.get('redirect_uri') !== authorization.redirect_uri) return reply(response, 400, { error: 'invalid_grant' });
          return reply(response, 200, await issue(authorization));
        }
        if (data.get('grant_type') === 'refresh_token') {
          controls.refreshCount += 1;
          if (controls.refreshBarrier) await controls.refreshBarrier;
          const authorization = refreshes.get(data.get('refresh_token')); refreshes.delete(data.get('refresh_token'));
          if (!authorization || controls.refreshFailure) return reply(response, 400, { error: 'invalid_grant', error_description: 'NEVER_RETURN_THIS_TOKEN' });
          return reply(response, 200, await issue({ ...authorization, nonce: undefined }));
        }
      }
      if (url.pathname === '/revoke') { controls.revokeCount += 1; refreshes.delete(data.get('token')); access.delete(data.get('token')); return reply(response, 200, {}); }
      if (url.pathname === '/logout') {
        controls.logoutCount += 1;
        controls.logoutOperationIds.push(data.get('operation_id'));
        const result = { operationId: data.get('operation_id'), scope: data.get('scope'), state: 'COMPLETED' };
        controls.logoutReceipts.set(result.operationId, result);
        return reply(response, controls.unknownLogout ? 503 : 200, controls.unknownLogout ? { code: 'UNKNOWN' } : result);
      }
      if (url.pathname.startsWith('/logout/operations/')) {
        controls.recoverCount += 1;
        controls.recoverOperationIds.push(url.pathname.split('/').at(-1));
        const result = controls.logoutReceipts.get(url.pathname.split('/').at(-1));
        return reply(response, result ? 200 : 404, result ?? { code: 'NOT_FOUND' });
      }
      return reply(response, 404, { code: 'NOT_FOUND' });
    } catch { reply(response, 500, { code: 'FIXTURE_ERROR' }); }
  });
  let application, rp;
  const config = { issuer: op.origin, clientId: 'external-rp-client', clientSecret: 'fixture-only-secret',
    scope: 'openid profile', timeoutSeconds: 3, sessionSeconds: options.sessionSeconds ?? 300, stateSeconds: 300, maxEntries: options.maxEntries ?? 5 };
  rp = await listen((request, response) => application.handler(request, response));
  config.origin = rp.origin; config.redirectUri = `${rp.origin}/auth/callback`;
  const outbound = secureFetch({ origin: op.origin, ca: tls.cert, timeoutSeconds: 3 });
  let oidc;
  try { oidc = await discover(config, outbound); application = await createApplication(config, { oidc }); }
  catch (error) { await rp.close(); await op.close(); throw error; }
  const request = async (url, init = {}) => {
    // Manual redirects are needed to test actual callback state/issuer errors.
    return new Promise((resolve, reject) => {
      const parsed = new URL(url), body = init.body;
      const req = https.request(parsed, { method: init.method ?? 'GET', ca: tls.cert, servername: 'localhost', headers: init.headers }, res => {
        const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => resolve({ status: res.statusCode,
          headers: res.headers, text: Buffer.concat(chunks).toString(), json() { return JSON.parse(this.text); } }));
      }); req.on('error', reject); if (body) req.write(body); req.end();
    });
  };
  const browser = () => {
    let cookie, csrf;
    const call = async (path, method = 'GET', value, extra = {}) => {
      const response = await request(`${rp.origin}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(method === 'POST' ? { Origin: rp.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}), ...extra },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
      if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
      if (path === '/api/session' && response.status === 200) csrf = response.json().csrfToken;
      return response;
    };
    const callback = async mutate => {
      const started = (await call('/auth/login', 'POST', {})).json();
      const authorization = await request(started.authorizationUrl); const url = new URL(authorization.headers.location);
      if (mutate) mutate(url);
      return { response: await call(url.pathname + url.search), callbackUrl: url, authorizationUrl: started.authorizationUrl };
    };
    return { call, callback, login: async () => {
      await call('/api/session'); const result = await callback();
      if (result.response.status === 303) await call('/api/session');
      return result;
    } };
  };
  return { config, controls, op, rp, request, browser, oidc,
    logoutToken: async (overrides = {}, header = {}, wrongKey = false) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ iss: op.origin, aud: config.clientId, sub: controls.subject, sid: controls.sid,
        jti: uuidV7(), iat: now, exp: now + 120,
        events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'logout+jwt', ...header }).sign(wrongKey ? wrongKeys.privateKey : keys.privateKey);
    },
    backchannel: async token => request(`${rp.origin}/auth/backchannel-logout`, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }).toString() }),
    close: async () => { application.close(); await rp.close(); await op.close(); },
  };
}
