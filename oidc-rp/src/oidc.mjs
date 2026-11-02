import * as client from 'openid-client';
import { randomBytes } from 'node:crypto';
import { secureFetch } from './transport.mjs';
import { PublicError } from './config.mjs';

export function uuidV7() {
  const value = randomBytes(16); value.writeUIntBE(Date.now(), 0, 6);
  value[6] = (value[6] & 15) | 112; value[8] = (value[8] & 63) | 128;
  const hex = value.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function endpoint(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw new PublicError('INVALID_DISCOVERY', 502); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.hash || url.search || url.pathname.startsWith('/internal/')) throw new PublicError('INVALID_DISCOVERY', 502);
  return url.href;
}

export async function discover(config, fetchImplementation = secureFetch({ origin: config.issuer, timeoutSeconds: config.timeoutSeconds })) {
  const oidc = await client.discovery(new URL(config.issuer), config.clientId,
    { client_secret: config.clientSecret, id_token_signed_response_alg: 'RS256' },
    client.ClientSecretBasic(config.clientSecret), { [client.customFetch]: fetchImplementation, timeout: config.timeoutSeconds });
  const metadata = oidc.serverMetadata();
  if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported?.includes('S256') ||
      !metadata.id_token_signing_alg_values_supported?.includes('RS256')) throw new PublicError('INVALID_DISCOVERY', 502);
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri', 'revocation_endpoint']) endpoint(metadata[key], config.issuer);
  if (metadata.rp_logout_command_endpoint !== undefined) endpoint(metadata.rp_logout_command_endpoint, config.issuer);
  client.enableNonRepudiationChecks(oidc);
  return { configuration: oidc, fetch: fetchImplementation, metadata };
}

export async function beginLogin(oidc, config, prompt) {
  const verifier = client.randomPKCECodeVerifier(), state = client.randomState(), nonce = client.randomNonce();
  const parameters = { response_type: 'code', redirect_uri: config.redirectUri, scope: config.scope,
    code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce };
  if (prompt) parameters.prompt = prompt;
  return { state, nonce, verifier, authorizationUrl: client.buildAuthorizationUrl(oidc.configuration, parameters).href };
}

export async function finishLogin(oidc, callback, flow) {
  return client.authorizationCodeGrant(oidc.configuration, callback,
    { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
}

export function tokenData(tokens, original, requestedScope) {
  const claims = tokens.claims();
  if ((!original && !claims) || typeof tokens.access_token !== 'string' || !tokens.access_token ||
      tokens.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new PublicError('INVALID_TOKEN_RESPONSE', 502);
  const subject = claims?.sub ?? original?.subject, sid = claims?.sid ?? original?.sid;
  if (typeof subject !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(subject) || typeof sid !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(sid)) throw new PublicError('INVALID_PUBLIC_IDENTITY', 502);
  if (original && (subject !== original.subject || sid !== original.sid)) throw new PublicError('SOURCE_CHANGED', 401);
  const refreshToken = tokens.refresh_token;
  if (original && (!refreshToken || refreshToken === original.refreshToken)) throw new PublicError('INVALID_REFRESH_ROTATION', 401);
  const allowedScope = original?.scope ?? requestedScope, scope = tokens.scope ?? allowedScope;
  if (typeof scope !== 'string' || !scope || (allowedScope && scope.split(' ').some(value => !allowedScope.split(' ').includes(value)))) throw new PublicError('SCOPE_CHANGED', 401);
  return { subject, sid, accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000, scope };
}

export async function userInfo(oidc, tokens) {
  return client.fetchUserInfo(oidc.configuration, tokens.accessToken, tokens.subject);
}

export async function refresh(oidc, tokens) {
  return tokenData(await client.refreshTokenGrant(oidc.configuration, tokens.refreshToken), tokens);
}

export async function revoke(oidc, tokens) {
  // The refresh family is removed first; never retry an uncertain revocation.
  if (tokens.refreshToken) await client.tokenRevocation(oidc.configuration, tokens.refreshToken, { token_type_hint: 'refresh_token' });
  await client.tokenRevocation(oidc.configuration, tokens.accessToken, { token_type_hint: 'access_token' });
}

function basic(config) {
  const encode = value => new URLSearchParams({ value }).toString().slice(6);
  return `Basic ${Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`).toString('base64')}`;
}

export async function logoutCommand(oidc, config, pending, recover = false) {
  const target = oidc.metadata.rp_logout_command_endpoint;
  if (!target) throw new PublicError('RP_LOGOUT_EXTENSION_UNAVAILABLE', 503);
  const body = new URLSearchParams({ token: pending.token, scope: pending.scope,
    operation_id: pending.operationId, sid: pending.sid, sub: pending.subject });
  const url = recover ? `${target}/operations/${pending.operationId}` : target;
  let response;
  try { response = await oidc.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(config) }, body }); }
  catch { throw new PublicError('LOGOUT_RESULT_UNKNOWN', 503); }
  let value;
  try { value = await response.json(); } catch { throw new PublicError('LOGOUT_RESULT_UNKNOWN', 503); }
  if (recover && response.status === 404 && value.code === 'NOT_FOUND') return logoutCommand(oidc, config, pending, false);
  if (!response.ok) throw new PublicError(response.status >= 500 ? 'LOGOUT_RESULT_UNKNOWN' : 'LOGOUT_REJECTED', response.status >= 500 ? 503 : 400);
  if (value.operationId !== pending.operationId || value.scope !== pending.scope || value.state !== 'COMPLETED') throw new PublicError('LOGOUT_RESULT_UNKNOWN', 503);
  return { operationId: value.operationId, scope: value.scope, state: value.state };
}
