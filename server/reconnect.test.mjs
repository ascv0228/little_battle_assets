import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoStore } from './store.mjs';
import * as service from './index.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const config = { uri: 'mongodb://test.invalid', database: 'recovery_test' };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('initial ping failure stays unavailable and retry waits for failed-client cleanup', async () => {
  const firstPing = deferred();
  const cleanup = deferred();
  const recoveryPing = deferred();
  const h = harness([
    { ping: () => firstPing.promise, close: () => cleanup.promise },
    { ping: () => recoveryPing.promise },
  ]);
  const connection = h.store.connect(config);
  try {
    await flush();
    assert.equal(h.store.db, undefined, 'connect alone must not publish the database');
    assert.equal(await h.store.healthy(), false);
    assert.equal(h.store.connect(config), connection);
    firstPing.reject(new Error('initial ping failed'));
    await flush();
    assert.equal(h.clients[0].closed, 1);
    assert.equal(h.clients.length, 1, 'no new client while cleanup is pending');
    assert.equal(h.waits.length, 0);
    assert.equal(h.store.db, undefined);
    assert.equal(h.store.connect(config), connection);
    cleanup.resolve();
    await flush();
    assert.equal(h.waits[0].ms, 1000);
    h.waits[0].resolve();
    await flush();
    assert.equal(h.clients.length, 2);
    assert.equal(h.store.db, undefined, 'retry also waits for its ping');
    assert.equal(await h.store.healthy(), false);
    recoveryPing.resolve();
    await connection;
    assert.equal(await h.store.healthy(), true);
    assert.equal(h.peak, 1);
  } finally {
    firstPing.resolve();
    cleanup.resolve();
    recoveryPing.resolve();
    await h.store.close();
  }
});

test('startup listens before Mongo completes, serves assets and API503, then recovers the same HTTP server', { timeout: 5000 }, async () => {
  assert.equal(typeof service.startServer, 'function', 'startup must expose a nonblocking listener entry point');
  const scratch = process.env.HERMES_TEST_TMPDIR || path.join(homedir(), '.cache', 'little-battle-assets-tests');
  await fs.mkdir(scratch, { recursive: true });
  const publicRoot = await fs.mkdtemp(path.join(scratch, 'mongo-reconnect-'));
  const version = 'a'.repeat(64);
  const files = [];
  for (const [name, data] of [['gameplay/stages.json', []], ['gameplay/summons.json', [{ character: 'hero' }]]]) {
    const bytes = Buffer.from(JSON.stringify(data));
    const target = path.join(publicRoot, 'releases', version, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    files.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await fs.writeFile(path.join(publicRoot, 'manifest.json'), JSON.stringify({ schema_version: 1, version, files }));
  // Only the Mongo transport is replaced; real MongoStore session/catalog/team methods and HTTP run.
  const collections = new Map();
  const db = { collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const docs = collections.get(name);
    return {
      async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); },
      async findOne({ _id }) { return structuredClone(docs.get(_id)); },
      async updateOne({ _id }, update, options) {
        if (!docs.has(_id) && options?.upsert) docs.set(_id, structuredClone({ _id, ...update.$setOnInsert }));
        const doc = docs.get(_id);
        if (doc && update.$set) Object.assign(doc, structuredClone(update.$set));
        return { matchedCount: doc ? 1 : 0 };
      },
    };
  } };
  const gate = deferred();
  const h = harness([{ connect: () => gate.promise }, { db }]);
  let server;
  let startup;
  try {
    startup = service.startServer({ ...config, host: '127.0.0.1', port: 0, publicRoot }, h.store);
    // A deadline catches accidental startup awaits without hanging the suite.
    let timer;
    try {
      server = await Promise.race([startup, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('listener blocked by Mongo connect')), 1000); })]);
    } finally { clearTimeout(timer); }
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(h.clients.length, 1);
    assert.equal((await fetch(url + '/assets/manifest.json')).status, 200);
    assert.equal((await fetch(`${url}/assets/releases/${version}/gameplay/stages.json`)).status, 200);
    const health = await fetch(url + '/health');
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { ok: false, database: 'unavailable', assets: true });
    for (const [route, method] of [['/api/session', 'POST'], ['/api/catalog', 'GET'], ['/api/player/team', 'GET'], ['/api/player/team', 'PUT']]) {
      const response = await fetch(url + route, { method });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'DATABASE_UNAVAILABLE' });
    }
    assert.equal(collections.size, 0, 'no fallback database writes during outage');
    gate.reject(new Error('simulated first-connect outage'));
    await flush();
    assert.equal(h.clients[0].closed, 1);
    h.waits[0].resolve();
    await h.store.connect(config);
    assert.equal((await fetch(url + '/health')).status, 200);
    const session = await fetch(url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(session.status, 200);
    const { token } = await session.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    const catalog = await fetch(url + '/api/catalog');
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).version, version);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const slots = ['hero', ...Array(15).fill(null)];
    const saved = await fetch(url + '/api/player/team', { method: 'PUT', headers, body: JSON.stringify({ slots }) });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { slots });
    const team = await fetch(url + '/api/player/team', { headers });
    assert.equal(team.status, 200);
    assert.deepEqual(await team.json(), { slots });
    assert.equal(h.clients.length, 2);
    assert.equal(h.peak, 1);
  } finally {
    gate.resolve();
    await h.store.close();
    server ??= await startup;
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(publicRoot, { recursive: true, force: true });
  }
});

test('transient ping failures reuse the driver client and a late health ping cannot survive close', async () => {
  let mode = 'ready';
  const gate = deferred();
  const h = harness([{ ping: async () => {
    if (mode === 'offline') throw new Error('transient network failure');
    if (mode === 'pending') await gate.promise;
  } }]);
  try {
    const connection = h.store.connect(config);
    await connection;
    mode = 'offline';
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => h.store.healthy())), Array(8).fill(false));
    assert.equal(h.store.connect(config), connection);
    assert.equal(h.clients.length, 1);
    assert.equal(h.waits.length, 0);
    mode = 'ready';
    assert.equal(await h.store.healthy(), true);
    mode = 'pending';
    const health = h.store.healthy();
    await flush();
    await h.store.close();
    gate.resolve();
    assert.equal(await health, false, 'a completed ping must not report a closed store ready');
    assert.equal(h.clients.length, 1);
  } finally { gate.resolve(); await h.store.close(); }
});

for (const phase of ['factory', 'connect', 'ping']) {
  test(`close during ${phase} closes late client completion without publishing a database`, async () => {
    const gate = deferred();
    const h = harness([{ [phase]: () => gate.promise }]);
    const connection = h.store.connect(config);
    try {
      await flush();
      assert.equal(h.store.db, undefined);
      assert.equal(await h.store.healthy(), false);
      await h.store.close();
      if (phase !== 'factory') assert.equal(h.clients[0].closed, 1, 'close in-flight client promptly');
      gate.resolve();
      await connection;
      assert.equal(h.store.db, undefined, 'late completion never restores readiness');
      assert.equal(await h.store.healthy(), false);
      assert.ok(h.clients[0].closed >= 1, 'late client was closed');
      if (phase !== 'factory') assert.equal(h.clients[0].closed, 2, 'close again after late completion');
      assert.equal(h.clients.length, 1);
      assert.equal(h.waits.length, 0);
      await assert.rejects(h.store.connect(config), /closed/);
    } finally { gate.resolve(); await h.store.close(); }
  });
}

function harness(outcomes = []) {
  const clients = [];
  const waits = [];
  let active = 0;
  let peak = 0;
  const store = new MongoStore({
    async clientFactory() {
      const outcome = outcomes[clients.length] || {};
      const client = {
        closed: 0,
        async connect() {
          active++;
          peak = Math.max(peak, active);
          try { await outcome.connect?.(); } finally { active--; }
        },
        db() { return { ...outcome.db, command: async () => { await outcome.ping?.(); } }; },
        async close() { client.closed++; await outcome.close?.(); },
      };
      clients.push(client);
      await outcome.factory?.();
      return client;
    },
    sleep(ms, { signal }) {
      const wait = deferred();
      waits.push({ ms, ...wait });
      if (signal.aborted) wait.reject(signal.reason);
      else signal.addEventListener('abort', () => wait.reject(signal.reason), { once: true });
      return wait.promise;
    },
  });
  return { store, clients, waits, get peak() { return peak; } };
}

test('failed first connect closes its client and recovers after controlled backoff', async () => {
  const h = harness([{ connect() { throw new Error('offline'); } }, {}]);
  const connection = h.store.connect(config);
  // Observe rejections so a missing retry fails as an assertion, not an unhandled rejection.
  connection.catch(() => {});
  try {
    await flush();
    assert.equal(h.clients.length, 1, 'uses the injected Mongo client factory');
    assert.equal(h.clients[0].closed, 1);
    assert.equal(await h.store.healthy(), false);
    assert.equal(h.waits[0].ms, 1000);
    h.waits[0].resolve();
    assert.equal(await connection, h.store);
    assert.equal(h.clients.length, 2);
    assert.equal(await h.store.healthy(), true);
    assert.equal(h.peak, 1);
  } finally { await h.store.close(); }
});

test('one shared retry loop caps exponential backoff and stops when closed during backoff', async () => {
  const h = harness(Array.from({ length: 10 }, () => ({ connect() { throw new Error('offline'); } })));
  const connection = h.store.connect(config);
  try {
    assert.equal(h.store.connect(config), connection);
    for (const [index, ms] of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000].entries()) {
      await flush();
      assert.equal(h.waits[index].ms, ms);
      assert.equal(h.clients.length, index + 1);
      assert.equal(h.clients[index].closed, 1);
      assert.equal(h.store.connect(config), connection);
      assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => h.store.healthy())), Array(5).fill(false));
      if (index < 7) h.waits[index].resolve();
    }
    await h.store.close();
    await flush();
    // Even a sleeper that resolves after cancellation must not reconnect.
    h.waits.at(-1).resolve();
    assert.equal(await Promise.race([connection.then(() => true), flush().then(() => false)]), true, 'shutdown settles the retry loop');
    assert.equal(h.clients.length, 8);
    assert.equal(h.peak, 1);
    await assert.rejects(h.store.connect(config), /closed/);
  } finally { await h.store.close(); }
});
