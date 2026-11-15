import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const tokenHash = token => createHash('sha256').update(token).digest('hex');

export class MongoStore {
  constructor({ clientFactory = async (uri, options) => {
    const { MongoClient } = await import('mongodb');
    return new MongoClient(uri, options);
  }, sleep: wait = (ms, { signal }) => sleep(ms, undefined, { signal }) } = {}) {
    this.clientFactory = clientFactory;
    this.sleep = wait;
    this.shutdown = new AbortController();
  }

  connect(config) {
    if (this.shutdown.signal.aborted) return Promise.reject(new Error('Store is closed'));
    if (!config.uri) return Promise.reject(new Error('MONGODB_URI is not configured'));
    this.connection ??= this.recover(config);
    return this.connection;
  }

  async recover(config) {
    let delay = 1000;
    while (!this.shutdown.signal.aborted) {
      let client;
      try {
        client = await this.clientFactory(config.uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
        this.shutdown.signal.throwIfAborted();
        this.client = client;
        await client.connect();
        this.shutdown.signal.throwIfAborted();
        const db = client.db(config.database);
        await db.command({ ping: 1 });
        await db.command({ createIndexes: 'users', indexes: [{ key: { username: 1 }, name: 'unique_username', unique: true }] });
        await db.command({ createIndexes: 'sessions', indexes: [{ key: { expiresAt: 1 }, name: 'session_expiry', expireAfterSeconds: 0 }] });
        this.shutdown.signal.throwIfAborted();
        this.db = db;
        return this;
      } catch {
        if (client) await client.close().catch(() => {});
        this.client = undefined;
        if (this.shutdown.signal.aborted) return this;
        try { await this.sleep(delay, { signal: this.shutdown.signal }); } catch { return this; }
        delay = Math.min(delay * 2, 30000);
      }
    }
    return this;
  }

  async healthy() {
    if (!this.db) return false;
    try { await this.db.command({ ping: 1 }); return !this.shutdown.signal.aborted; } catch { return false; }
  }

  async catalog(raw) {
    if (!this.db) throw new Error('Database unavailable');
    await this.db.collection('catalogs').updateOne({ _id: raw.version }, { $setOnInsert: raw }, { upsert: true });
    const { _id, ...catalog } = await this.db.collection('catalogs').findOne({ _id: raw.version });
    return catalog;
  }

  async createUser(user) {
    await this.db.collection('users').insertOne(user);
    await this.ensurePlayer(user._id);
  }

  async ensurePlayer(userId) {
    await this.db.collection('players').updateOne({ _id: userId }, { $setOnInsert: { slots: null, createdAt: new Date() } }, { upsert: true });
  }

  async findUser(username) { return this.db.collection('users').findOne({ username }); }

  async createSession(token, userId, expiresAt) {
    await this.ensurePlayer(userId);
    await this.db.collection('sessions').insertOne({ _id: tokenHash(token), userId, expiresAt });
  }

  async sessionUser(token, now = new Date()) {
    const session = await this.db.collection('sessions').findOne({ _id: tokenHash(token), expiresAt: { $gt: now } });
    if (!session) return null;
    const user = await this.db.collection('users').findOne({ _id: session.userId });
    return user ? { user, expiresAt: session.expiresAt } : null;
  }

  async revokeSession(token, now = new Date()) {
    const result = await this.db.collection('sessions').deleteOne({ _id: tokenHash(token), expiresAt: { $gt: now } });
    return result.deletedCount === 1;
  }

  async session(existing) {
    if (!this.db) throw new Error('Database unavailable');
    // Anonymous identity lookup is deliberately separate: no account conversion or import.
    if (existing) return await this.db.collection('players').findOne({ _id: tokenHash(existing) }) ? existing : null;
    const token = randomBytes(32).toString('hex');
    await this.db.collection('players').insertOne({ _id: tokenHash(token), slots: null, createdAt: new Date() });
    return token;
  }

  async player(token) {
    if (!this.db) throw new Error('Database unavailable');
    const session = await this.sessionUser(token);
    return this.db.collection('players').findOne({ _id: session ? session.user._id : tokenHash(token) });
  }

  async saveTeam(token, slots) {
    const player = await this.player(token);
    if (!player) return false;
    const result = await this.db.collection('players').updateOne({ _id: player._id }, { $set: { slots, updatedAt: new Date() } });
    return result.matchedCount === 1;
  }

  async close() {
    this.shutdown.abort();
    this.db = undefined;
    const client = this.client;
    this.client = undefined;
    await client?.close();
  }
}

// Explicitly injected test double; production never falls back to volatile storage.
export class MemoryStore {
  players = new Map();
  catalogs = new Map();
  users = new Map();
  sessions = new Map();
  async createUser(user) {
    if (this.users.has(user.username)) throw Object.assign(new Error('Duplicate username'), { code: 11000 });
    this.users.set(user.username, structuredClone(user));
    this.players.set(user._id, { slots: null });
  }
  async findUser(username) { return structuredClone(this.users.get(username)); }
  async createSession(token, userId, expiresAt) { this.sessions.set(tokenHash(token), { userId, expiresAt }); }
  async sessionUser(token, now = new Date()) {
    const session = this.sessions.get(tokenHash(token));
    if (!session || session.expiresAt <= now) return null;
    const user = [...this.users.values()].find(user => user._id === session.userId);
    return user ? structuredClone({ user, expiresAt: session.expiresAt }) : null;
  }
  async revokeSession(token, now = new Date()) {
    if (!await this.sessionUser(token, now)) return false;
    return this.sessions.delete(tokenHash(token));
  }
  async healthy() { return true; }
  async catalog(raw) { if (!this.catalogs.has(raw.version)) this.catalogs.set(raw.version, structuredClone(raw)); return structuredClone(this.catalogs.get(raw.version)); }
  async session(existing) { if (existing) return this.players.has(tokenHash(existing)) ? existing : null; const t = randomBytes(32).toString('hex'); this.players.set(tokenHash(t), { slots: null }); return t; }
  async player(token) {
    const session = await this.sessionUser(token);
    return this.players.get(session ? session.user._id : tokenHash(token));
  }
  async saveTeam(token, slots) { const player = await this.player(token); if (!player) return false; player.slots = [...slots]; return true; }
  async close() {}
}
