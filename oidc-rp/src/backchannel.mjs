import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';
import { PublicError } from './config.mjs';

const eventName = 'http://schemas.openid.net/event/backchannel-logout';
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function logoutVerifier(oidc, config) {
  const keys = createRemoteJWKSet(new URL(oidc.metadata.jwks_uri), { [customFetch]: oidc.fetch, timeoutDuration: config.timeoutSeconds * 1000 });
  return async token => {
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      const header = decodeProtectedHeader(token);
      if (header.typ !== 'logout+jwt' || header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(header.kid) ||
          Object.keys(header).some(key => !['alg', 'kid', 'typ'].includes(key))) throw new Error();
      const { payload } = await jwtVerify(token, keys, { issuer: config.issuer, audience: config.clientId,
        algorithms: ['RS256'], typ: 'logout+jwt', clockTolerance: 5,
        requiredClaims: ['iss', 'aud', 'sid', 'sub', 'jti', 'iat', 'exp', 'events'] });
      const now = Math.floor(Date.now() / 1000);
      if (Object.keys(payload).some(key => !['iss', 'aud', 'sid', 'sub', 'jti', 'iat', 'exp', 'events'].includes(key)) ||
          payload.aud !== config.clientId || typeof payload.sid !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(payload.sid) ||
          typeof payload.sub !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(payload.sub) || !uuidV7.test(payload.jti) ||
          !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > now + 5 || now - payload.iat > 120 ||
          payload.exp !== payload.iat + 120 || payload.exp <= now || !payload.events || typeof payload.events !== 'object' || Array.isArray(payload.events) ||
          Object.keys(payload.events).length !== 1 || !Object.hasOwn(payload.events, eventName) ||
          !payload.events[eventName] || typeof payload.events[eventName] !== 'object' || Array.isArray(payload.events[eventName]) || Object.keys(payload.events[eventName]).length !== 0) throw new Error();
      return payload;
    } catch { throw new PublicError('INVALID_LOGOUT_TOKEN'); }
  };
}
