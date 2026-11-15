import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let activeHashes = 0;
export class AuthError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const publicUser = user => ({ id: user._id, username: user.username });

function credentials(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError(400, 'INVALID_INPUT');
  if (typeof input.username !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(input.username)) throw new AuthError(400, 'INVALID_USERNAME');
  if (typeof input.password !== 'string' || [...input.password].length < 6 || [...input.password].length > 128 || Buffer.byteLength(input.password, 'utf8') > 512) throw new AuthError(400, 'INVALID_PASSWORD');
  return { username: input.username.toLowerCase(), password: input.password };
}

export function createAuth(store, { now = () => Date.now(), deriveKey = derive, throttleCapacity = 10000 } = {}) {
  const attemptsByUsername = new Map();
  const attemptsByIP = new Map();
  const registrationsByUsername = new Map();
  const registrationsByIP = new Map();
  const dummySalt = randomBytes(16);
  const dummyHash = Buffer.alloc(64);
  async function hash(password, salt) {
    if (activeHashes >= 2) throw new AuthError(503, 'AUTH_BUSY');
    activeHashes++;
    try { return await deriveKey(password, salt, 64, scryptOptions); }
    finally { activeHashes--; }
  }
  function throttle(username, remoteIP, usernameMap = attemptsByUsername, ipMap = attemptsByIP) {
    const time = now();
    const entries = [[usernameMap, username], [ipMap, remoteIP || 'unknown']];
    for (const [map, key] of entries) {
      for (const [id, attempt] of map) if (attempt.expiresAt <= time) map.delete(id);
      if ((!map.has(key) && map.size >= throttleCapacity) || (map.get(key)?.count || 0) >= 10) throw new AuthError(429, 'RATE_LIMITED');
    }
    for (const [map, key] of entries) {
      const attempt = map.get(key) || { count: 0, expiresAt: time + 60000 };
      attempt.count++;
      map.set(key, attempt);
    }
  }
  async function requireSession(token) {
    const session = await store.sessionUser(token, new Date(now()));
    if (!session) throw new AuthError(401, 'AUTH_REQUIRED');
    return session;
  }
  async function issue(user) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now() + sessionLifetime);
    await store.createSession(token, user._id, expiresAt);
    return { user: publicUser(user), token, expiresAt: expiresAt.toISOString() };
  }
  return {
    async register(input, remoteIP) {
      const { username, password } = credentials(input);
      throttle(username, remoteIP, registrationsByUsername, registrationsByIP);
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await hash(password, Buffer.from(salt, 'hex'))).toString('hex');
      const user = { _id: randomUUID(), username, salt, passwordHash, createdAt: new Date(now()) };
      // The unique users.username index arbitrates races; duplicates are explicitly 409 ACCOUNT_EXISTS.
      try { await store.createUser(user); } catch (error) {
        if (error.code === 11000) throw new AuthError(409, 'ACCOUNT_EXISTS');
        throw error;
      }
      return issue(user);
    },
    async login(input, remoteIP) {
      let username, password;
      try { ({ username, password } = credentials(input)); } catch (error) {
        if (error.code === 'INVALID_INPUT') throw error;
        throw new AuthError(401, 'INVALID_CREDENTIALS');
      }
      throttle(username, remoteIP);
      const user = await store.findUser(username);
      const actual = await hash(password, user ? Buffer.from(user.salt, 'hex') : dummySalt);
      const matches = timingSafeEqual(actual, user ? Buffer.from(user.passwordHash, 'hex') : dummyHash);
      if (!user || !matches) throw new AuthError(401, 'INVALID_CREDENTIALS');
      return issue(user);
    },
    async me(token) {
      const { user, expiresAt } = await requireSession(token);
      return { user: publicUser(user), expiresAt: expiresAt.toISOString() };
    },
    async logout(token) {
      await requireSession(token);
      if (!await store.revokeSession(token, new Date(now()))) throw new AuthError(401, 'AUTH_REQUIRED');
      return { ok: true };
    },
  };
}
