import { readFileSync } from 'node:fs';

export class PublicError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function httpsOrigin(value, key) {
  let url;
  try { url = new URL(value); } catch { throw new PublicError(`INVALID_${key}`); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new PublicError(`INVALID_${key}`);
  }
  return url.origin;
}

function number(values, key, fallback, maximum) {
  const raw = values[key] ?? String(fallback);
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > maximum) throw new PublicError(`INVALID_${key}`);
  return Number(raw);
}

function identifier(value, key) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value)) throw new PublicError(`INVALID_${key}`);
  return value;
}

export function secretFile(file, key) {
  try {
    const value = readFileSync(file, 'utf8').trim();
    if (!value || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) throw new Error();
    return value;
  } catch { throw new PublicError(`INVALID_${key}`); }
}

export function loadConfig(values = process.env) {
  const origin = httpsOrigin(values.RP_ORIGIN, 'RP_ORIGIN');
  const issuer = httpsOrigin(values.OIDC_ISSUER, 'OIDC_ISSUER');
  const scope = values.OIDC_SCOPES ?? 'openid profile';
  const scopes = scope.split(' ');
  if (!scopes.includes('openid') || scopes.length !== new Set(scopes).size ||
      scopes.some(value => !['openid', 'profile', 'offline_access'].includes(value))) throw new PublicError('INVALID_OIDC_SCOPES');
  const tlsCert = values.RP_TLS_CERT_FILE, tlsKey = values.RP_TLS_KEY_FILE;
  if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new PublicError('INCOMPLETE_RP_TLS');
  return Object.freeze({
    origin, issuer, scope,
    clientId: identifier(values.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID'),
    clientSecret: secretFile(values.OIDC_CLIENT_SECRET_FILE, 'OIDC_CLIENT_SECRET_FILE'),
    redirectUri: `${origin}/auth/callback`,
    host: values.RP_BIND_HOST ?? '127.0.0.1',
    port: number(values, 'RP_BIND_PORT', 3012, 65535),
    sessionSeconds: number(values, 'RP_SESSION_SECONDS', 300, 300),
    stateSeconds: number(values, 'RP_STATE_SECONDS', 300, 300),
    maxEntries: number(values, 'RP_MAX_ENTRIES', 200, 10000),
    timeoutSeconds: number(values, 'RP_HTTP_TIMEOUT_SECONDS', 5, 10),
    ...(tlsCert ? { tls: { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } } : {}),
  });
}

export function loadMachineConfig(values = process.env) {
  const issuer = httpsOrigin(values.MACHINE_ISSUER, 'MACHINE_ISSUER');
  const scope = values.MACHINE_SCOPE;
  if (typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(scope) ||
      scope.split(' ').some(value => ['openid', 'profile', 'offline_access'].includes(value))) throw new PublicError('INVALID_MACHINE_SCOPE');
  let resourceUrl;
  if (values.MACHINE_RESOURCE_URL) {
    try { resourceUrl = new URL(values.MACHINE_RESOURCE_URL); } catch { throw new PublicError('INVALID_MACHINE_RESOURCE_URL'); }
    if (resourceUrl.protocol !== 'https:' || resourceUrl.username || resourceUrl.password || resourceUrl.hash || resourceUrl.search) throw new PublicError('INVALID_MACHINE_RESOURCE_URL');
  }
  return Object.freeze({ issuer, scope, clientId: identifier(values.MACHINE_CLIENT_ID, 'MACHINE_CLIENT_ID'),
    clientSecret: secretFile(values.MACHINE_CLIENT_SECRET_FILE, 'MACHINE_CLIENT_SECRET_FILE'), timeoutSeconds: 5, resourceUrl });
}
