import https from 'node:https';
import { PublicError } from './config.mjs';

/** Bounded HTTPS with normal hostname/CA validation, no proxy or redirects. */
export function secureFetch({ origin, timeoutSeconds = 5, ca } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        (origin && url.origin !== origin) || url.pathname.startsWith('/internal/')) throw new PublicError('UNTRUSTED_ENDPOINT', 502);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    let body = init.body;
    if (body instanceof URLSearchParams) body = body.toString();
    if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) throw new PublicError('UNSUPPORTED_REQUEST_BODY', 502);
    if (body && Buffer.byteLength(body) > 32768) throw new PublicError('REQUEST_TOO_LARGE', 502);
    if (headers.has('transfer-encoding')) throw new PublicError('INVALID_REQUEST_FRAMING', 502);
    if (body !== undefined && body !== null) {
      // Native https.request does not calculate this like Fetch does. Explicit
      // byte framing also works through strict gateways that reject chunking.
      const length = String(Buffer.byteLength(body));
      if (headers.has('content-length') && headers.get('content-length') !== length) throw new PublicError('INVALID_REQUEST_FRAMING', 502);
      headers.set('content-length', length);
    } else if (headers.has('content-length') && headers.get('content-length') !== '0') throw new PublicError('INVALID_REQUEST_FRAMING', 502);
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: init.method ?? (input instanceof Request ? input.method : 'GET'),
        headers: Object.fromEntries(headers), ...(ca ? { ca } : {}), signal,
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); reject(new PublicError('UPSTREAM_REDIRECT', 502)); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 262144) { response.destroy(); reject(new PublicError('UPSTREAM_TOO_LARGE', 502)); }
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new PublicError('UPSTREAM_UNAVAILABLE', 502)));
        response.on('end', () => {
          const replyHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) replyHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers: replyHeaders }));
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('TIMEOUT')), timeoutSeconds * 1000);
      request.on('close', () => clearTimeout(timer));
      request.on('error', () => reject(new PublicError('UPSTREAM_UNAVAILABLE', 502)));
      if (body) request.write(body);
      request.end();
    });
  };
}
