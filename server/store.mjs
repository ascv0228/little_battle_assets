import { createHash, randomBytes } from 'node:crypto';

const tokenHash = token => createHash('sha256').update(token).digest('hex');

export class MongoStore {
  async connect(config) {
    if (!config.uri) throw new Error('MONGODB_URI is not configured');
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
    await this.client.connect();
    this.db = this.client.db(config.database);
    await this.db.command({ ping: 1 });
    return this;
  }

  async healthy() {
    if (!this.db) return false;
    try { await this.db.command({ ping: 1 }); return true; } catch { return false; }
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

  async close() { await this.client?.close(); }
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
