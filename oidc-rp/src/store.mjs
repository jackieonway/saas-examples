import { createHash, randomBytes } from 'node:crypto';
import { PublicError } from './config.mjs';

export const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');

/** One bounded, single-process instance. A restart invalidates all local sessions. */
export class Sessions {
  constructor(config) { this.config = config; this.sessions = new Map(); this.receipts = new Map(); this.sources = new Map(); this.sourceOverflowUntil = 0; }
  clean(now = Date.now()) {
    for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
    for (const [key, value] of this.receipts) if (value <= now) this.receipts.delete(key);
    for (const [key, value] of this.sources) if (value.expiresAt <= now) this.sources.delete(key);
  }
  create() {
    this.clean();
    if (this.sessions.size >= this.config.maxEntries) throw new PublicError('SESSION_CAPACITY', 503);
    const value = { id: random(), csrf: random(), expiresAt: Date.now() + this.config.sessionSeconds * 1000, generation: 0 };
    this.sessions.set(value.id, value); return value;
  }
  get(id) { this.clean(); return this.sessions.get(id); }
  rotate(session, tokens, profile, generation) {
    this.assertLive(session, generation); this.assertSource(tokens.sid, tokens.subject);
    // An unrecorded revocation may belong to an anonymous callback currently
    // waiting upstream. Keep existing facts and block new attachment until all
    // flows that could predate the capacity failure have expired.
    if (this.sourceOverflowUntil > Date.now()) throw new PublicError('SOURCE_CAPACITY', 503);
    this.sessions.delete(session.id);
    session.id = random(); session.csrf = random(); session.tokens = tokens;
    session.profile = { displayName: typeof profile.name === 'string' ? profile.name.slice(0, 256) : '' };
    session.onlineCheckedAt = Date.now(); session.generation += 1;
    this.sessions.set(session.id, session); return session;
  }
  assertLive(session, generation) {
    if (this.get(session.id) !== session || (generation !== undefined && session.generation !== generation)) throw new PublicError('SESSION_CLOSED', 401);
  }
  assertSource(sid, subject) {
    this.clean(); const source = this.sources.get(digest(sid));
    if (source) throw new PublicError(source.subject === subject ? 'SOURCE_REVOKED' : 'SOURCE_MISMATCH', 401);
  }
  closeSessions(sid, subject) {
    let closed = 0;
    for (const session of this.sessions.values()) if (session.tokens?.sid === sid && session.tokens.subject === subject) {
      session.tokens = undefined; session.profile = undefined; session.flow = undefined; session.generation += 1; closed += 1;
    }
    return closed;
  }
  closeSource(sid, subject) {
    this.clean();
    const key = digest(sid), existing = this.sources.get(key);
    if (existing && existing.subject !== subject) throw new PublicError('SOURCE_MISMATCH');
    for (const session of this.sessions.values()) if (session.tokens?.sid === sid && session.tokens.subject !== subject) throw new PublicError('SOURCE_MISMATCH');
    // Local revocation must not depend on capacity for its durable-in-memory
    // fact. In-flight work loses its generation before any capacity failure.
    const closed = this.closeSessions(sid, subject);
    const expiresAt = Date.now() + (this.config.stateSeconds + this.config.sessionSeconds + 120) * 1000;
    if (!existing && this.sources.size >= this.config.maxEntries * 4) {
      this.sourceOverflowUntil = Math.max(this.sourceOverflowUntil, expiresAt);
      throw new PublicError('SOURCE_CAPACITY', 503);
    }
    // Longer than every pending authorization flow and local session combined.
    this.sources.set(key, { subject, expiresAt });
    return closed;
  }
  receiveLogout(jti, expiresAt, sid, subject) {
    this.clean(); const key = digest(`${this.config.issuer}\n${this.config.clientId}\n${jti}`);
    if (this.receipts.has(key)) throw new PublicError('BACKCHANNEL_REPLAY', 409);
    const closed = this.closeSource(sid, subject);
    if (this.receipts.size >= this.config.maxEntries * 20) throw new PublicError('REPLAY_CAPACITY', 503);
    this.receipts.set(key, expiresAt + 5000); return closed;
  }
}
