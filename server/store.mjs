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

  async session(existing) {
    if (!this.db) throw new Error('Database unavailable');
    if (existing) return await this.player(existing) ? existing : null;
    const token = randomBytes(32).toString('hex');
    await this.db.collection('players').insertOne({ _id: tokenHash(token), slots: null, createdAt: new Date() });
    return token;
  }

  async player(token) {
    if (!this.db) throw new Error('Database unavailable');
    return this.db.collection('players').findOne({ _id: tokenHash(token) });
  }

  async saveTeam(token, slots) {
    const result = await this.db.collection('players').updateOne({ _id: tokenHash(token) }, { $set: { slots, updatedAt: new Date() } });
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
  async healthy() { return true; }
  async catalog(raw) { if (!this.catalogs.has(raw.version)) this.catalogs.set(raw.version, structuredClone(raw)); return structuredClone(this.catalogs.get(raw.version)); }
  async session(existing) { if (existing) return this.players.has(tokenHash(existing)) ? existing : null; const t = randomBytes(32).toString('hex'); this.players.set(tokenHash(t), { slots: null }); return t; }
  async player(token) { return this.players.get(tokenHash(token)); }
  async saveTeam(token, slots) { const player = await this.player(token); if (!player) return false; player.slots = [...slots]; return true; }
  async close() {}
}
