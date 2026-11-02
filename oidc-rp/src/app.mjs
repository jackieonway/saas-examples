import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PublicError } from './config.mjs';
import { Sessions } from './store.mjs';
import { beginLogin, discover, finishLogin, logoutCommand, refresh, revoke, tokenData, userInfo, uuidV7 } from './oidc.mjs';
import { logoutVerifier } from './backchannel.mjs';

const cookieName = '__Host-oidc_rp';
const assets = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))]],
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/app.js', import.meta.url))]],
  ['/style.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/style.css', import.meta.url))]],
]);
const same = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

function headers(response) {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}
function json(response, status, body) { headers(response); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }
function cookie(response, session) { response.setHeader('Set-Cookie', `${cookieName}=${session.id}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))}`); }
function cookieId(request) {
  const values = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
  if (values.length > 1) throw new PublicError('DUPLICATE_COOKIE');
  const value = values[0]?.slice(cookieName.length + 1);
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : undefined;
}
async function body(request, type) {
  if ((request.headers['content-type'] ?? '').split(';')[0].trim() !== type) throw new PublicError('UNSUPPORTED_CONTENT_TYPE', 415);
  let bytes = 0; const parts = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 20000) throw new PublicError('BODY_TOO_LARGE', 413); parts.push(chunk); }
  const value = Buffer.concat(parts).toString('utf8');
  if (type === 'application/json') {
    try { const parsed = JSON.parse(value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; }
    catch { throw new PublicError('INVALID_JSON'); }
  }
  return new URLSearchParams(value);
}
function exactObject(value, keys) { if (Object.keys(value).some(key => !keys.includes(key))) throw new PublicError('UNKNOWN_FIELD'); }
function authenticated(store, session) { store.assertLive(session); if (!session.tokens) throw new PublicError('LOGIN_REQUIRED', 401); store.assertSource(session.tokens.sid, session.tokens.subject); }

export async function createApplication(config, { oidc: providedOidc } = {}) {
  const oidc = providedOidc ?? await discover(config), store = new Sessions(config), verifyLogout = logoutVerifier(oidc, config);
  const handler = async (request, response) => {
    try {
      if (request.headers.host !== new URL(config.origin).host || !request.url.startsWith('/') || request.url.startsWith('//')) throw new PublicError('INVALID_HOST');
      const url = new URL(request.url, config.origin), route = `${request.method} ${url.pathname}`;
      if (url.search && route !== 'GET /auth/callback') throw new PublicError('QUERY_NOT_ALLOWED');
      if (route === 'GET /health') return json(response, 200, { status: 'ready' });
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [type, bytes] = assets.get(url.pathname); headers(response); response.writeHead(200, { 'Content-Type': type }); response.end(bytes); return;
      }
      if (route === 'POST /auth/backchannel-logout') {
        const form = await body(request, 'application/x-www-form-urlencoded');
        if ([...form.keys()].length !== 1 || !form.has('logout_token')) throw new PublicError('INVALID_LOGOUT_FORM');
        const claims = await verifyLogout(form.get('logout_token'));
        const closed = store.receiveLogout(claims.jti, claims.exp * 1000, claims.sid, claims.sub);
        return json(response, 200, { state: 'ACCEPTED', closedSessions: closed });
      }
      let session = store.get(cookieId(request));
      if (route === 'GET /api/session') {
        if (!session) { session = store.create(); cookie(response, session); }
        if (session.tokens && !session.busy && Date.now() - session.onlineCheckedAt >= 60000) {
          const generation = session.generation, tokens = session.tokens;
          try { await userInfo(oidc, tokens); store.assertLive(session, generation); store.assertSource(tokens.sid, tokens.subject); session.onlineCheckedAt = Date.now(); }
          catch { if (session.generation === generation) { session.tokens = undefined; session.profile = undefined; session.generation += 1; } }
        }
        return json(response, 200, { authenticated: Boolean(session.tokens), csrfToken: session.csrf,
          expiresAt: session.expiresAt, hasRefreshToken: Boolean(session.tokens?.refreshToken),
          pendingLogout: Boolean(session.pendingLogout),
          logoutExtensionAvailable: Boolean(oidc.metadata.rp_logout_command_endpoint),
          identity: session.tokens ? { issuer: config.issuer, subject: session.tokens.subject, displayName: session.profile.displayName } : null });
      }
      if (!session) throw new PublicError('SESSION_REQUIRED', 401);
      if (route === 'GET /auth/callback') {
        if ([...url.searchParams.keys()].some(key => !['code', 'state', 'iss', 'error', 'error_description', 'error_uri'].includes(key)) ||
            [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)) throw new PublicError('INVALID_CALLBACK');
        const flow = session.flow; session.flow = undefined;
        if (!flow || flow.expiresAt <= Date.now() || !same(flow.state, url.searchParams.get('state'))) throw new PublicError('INVALID_STATE');
        if (session.busy || session.pendingLogout) throw new PublicError('OPERATION_PENDING', 409);
        const generation = session.generation; session.busy = true;
        try {
          const tokens = tokenData(await finishLogin(oidc, url, flow), undefined, config.scope);
          const profile = await userInfo(oidc, tokens); store.rotate(session, tokens, profile, generation);
          cookie(response, session); headers(response); response.writeHead(303, { Location: '/' }); response.end(); return;
        } finally { session.busy = false; }
      }
      if (route === 'GET /api/userinfo') {
        authenticated(store, session);
        if (session.busy) throw new PublicError('OPERATION_PENDING', 409);
        const generation = session.generation, tokens = session.tokens;
        try {
          const profile = await userInfo(oidc, tokens); store.assertLive(session, generation); store.assertSource(tokens.sid, tokens.subject);
          session.onlineCheckedAt = Date.now(); return json(response, 200, { issuer: config.issuer, subject: profile.sub, displayName: typeof profile.name === 'string' ? profile.name : '' });
        } catch (error) { if (session.generation === generation) { session.tokens = undefined; session.profile = undefined; session.generation += 1; } throw error; }
      }
      if (request.method !== 'POST') throw new PublicError('NOT_FOUND', 404);
      const originHeaders = request.rawHeaders.filter((_, index) => index % 2 === 0).filter(value => value.toLowerCase() === 'origin');
      if (originHeaders.length !== 1 || request.headers.origin !== config.origin || !same(session.csrf, request.headers['x-csrf-token'])) throw new PublicError('CSRF_REJECTED', 403);
      const input = await body(request, 'application/json');
      if (route === 'POST /auth/login') {
        exactObject(input, ['prompt']);
        if (input.prompt !== undefined && !['login', 'consent'].includes(input.prompt)) throw new PublicError('INVALID_PROMPT');
        if (session.busy || session.pendingLogout) throw new PublicError('OPERATION_PENDING', 409);
        const flow = await beginLogin(oidc, config, input.prompt); store.assertLive(session);
        session.flow = { ...flow, expiresAt: Date.now() + config.stateSeconds * 1000 };
        return json(response, 200, { authorizationUrl: flow.authorizationUrl });
      }
      if (route === 'POST /api/account/link') throw new PublicError('EXPLICIT_DUAL_CONTROL_LINK_REQUIRED', 409);
      if (route === 'POST /auth/logout/recover') {
        exactObject(input, []);
        if (!session.pendingLogout) throw new PublicError('NO_PENDING_LOGOUT', 404);
        if (session.busy) throw new PublicError('OPERATION_PENDING', 409);
        session.busy = true;
        try { const result = await logoutCommand(oidc, config, session.pendingLogout, true); session.pendingLogout = undefined; return json(response, 200, result); }
        finally { session.busy = false; }
      }
      if (!['POST /auth/refresh', 'POST /auth/revoke', 'POST /auth/logout'].includes(route)) throw new PublicError('NOT_FOUND', 404);
      exactObject(input, route === 'POST /auth/logout' ? ['scope'] : []); authenticated(store, session);
      if (session.busy || session.pendingLogout) throw new PublicError('OPERATION_PENDING', 409);
      const generation = session.generation, tokens = session.tokens; session.busy = true;
      try {
        if (route === 'POST /auth/refresh') {
          if (!tokens.refreshToken) throw new PublicError('REFRESH_UNAVAILABLE', 409);
          const next = await refresh(oidc, tokens); store.assertLive(session, generation); store.assertSource(next.sid, next.subject);
          session.tokens = next; session.generation += 1; session.onlineCheckedAt = 0;
          return json(response, 200, { state: 'REFRESHED', hasRefreshToken: true, expiresAt: next.expiresAt });
        }
        if (route === 'POST /auth/revoke') {
          store.closeSource(tokens.sid, tokens.subject); await revoke(oidc, tokens);
          return json(response, 200, { state: 'LOCAL_SESSION_CLOSED_AND_TOKENS_REVOKED' });
        }
        if (!['CURRENT_APP', 'GLOBAL'].includes(input.scope)) throw new PublicError('INVALID_LOGOUT_SCOPE');
        if (!oidc.metadata.rp_logout_command_endpoint) throw new PublicError('RP_LOGOUT_EXTENSION_UNAVAILABLE', 503);
        const pending = { operationId: uuidV7(), scope: input.scope, token: tokens.refreshToken ?? tokens.accessToken, sid: tokens.sid, subject: tokens.subject };
        session.pendingLogout = pending; store.closeSource(tokens.sid, tokens.subject);
        const result = await logoutCommand(oidc, config, pending); session.pendingLogout = undefined;
        return json(response, 200, result);
      } catch (error) {
        // An exchanged code or refresh token is never automatically retried.
        if (route === 'POST /auth/refresh' || route === 'POST /auth/revoke') { session.tokens = undefined; session.profile = undefined; session.generation += 1; }
        throw error;
      } finally { session.busy = false; }
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof PublicError ? error.status : 400,
        { code: error instanceof PublicError ? error.code : 'OIDC_REQUEST_REJECTED' });
      else response.destroy();
    }
  };
  return { handler, close: () => { store.sessions.clear(); store.sources.clear(); store.receipts.clear(); } };
}
