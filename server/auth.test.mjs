import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { createServer } from './index.mjs';
import { MemoryStore, MongoStore } from './store.mjs';
import { createAuth } from './auth.mjs';
import { fixture } from '../scripts/publish.test.mjs';

const password = 'correct horse battery staple';
async function running(options = {}) {
  const store = options.store || new MemoryStore();
  const server = createServer({ publicRoot: '.', store, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { store, url, async request(route, { method = 'GET', input, token, headers = {} } = {}) {
    const response = await fetch(url + route, { method, headers: { ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
    return { status: response.status, body: await response.json() };
  }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
const register = (f, username = 'Player_One', pass = password) => f.request('/api/auth/register', { method: 'POST', input: { username, password: pass } });
const login = (f, username = 'PLAYER_ONE', pass = password, headers) => f.request('/api/auth/login', { method: 'POST', input: { username, password: pass }, headers });

test('MongoStore transport contract persists account/team/session documents and queries expiration before TTL cleanup', async () => {
  // Only the Mongo transport is replaced; real HTTP, crypto, auth and MongoStore methods run.
  const collections = new Map();
  const queries = [];
  const commands = [];
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? doc[key] > value.$gt : doc[key] === value);
  const db = {
    async command(command) { commands.push(command); },
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const docs = collections.get(name);
      return {
        async insertOne(doc) {
          if (docs.has(doc._id) || (name === 'users' && [...docs.values()].some(user => user.username === doc.username))) throw Object.assign(new Error('duplicate key'), { code: 11000 });
          docs.set(doc._id, structuredClone(doc));
        },
        async findOne(query) { queries.push({ name, query: structuredClone(query) }); return structuredClone([...docs.values()].find(doc => matches(doc, query)) || null); },
        async updateOne(query, update, options) {
          let doc = [...docs.values()].find(doc => matches(doc, query));
          if (!doc && options?.upsert) {
            doc = structuredClone({ ...query, ...update.$setOnInsert });
            docs.set(doc._id, doc);
          }
          if (doc) Object.assign(doc, structuredClone(update.$set));
          return { matchedCount: doc ? 1 : 0 };
        },
        async deleteOne(query) {
          queries.push({ name, query: structuredClone(query) });
          const doc = [...docs.values()].find(doc => matches(doc, query));
          if (doc) docs.delete(doc._id);
          return { deletedCount: doc ? 1 : 0 };
        },
      };
    },
  };
  const store = new MongoStore({ clientFactory: async () => ({ connect: async () => {}, db: () => db, close: async () => {} }) });
  await store.connect({ uri: 'mongodb://test.invalid', database: 'auth_test' });
  const assets = await fixture();
  const f = await running({ store, publicRoot: assets.publicRoot });
  try {
    const a = (await register(f, 'mongo_user')).body;
    const b = (await register(f, 'other_user')).body;
    assert.deepEqual(await register(f, 'MONGO_USER'), { status: 409, body: { error: 'ACCOUNT_EXISTS' } });
    const again = (await login(f, 'Mongo_User')).body;
    const slots = ['hero', ...Array(15).fill(null)];
    assert.equal((await f.request('/api/player/team', { method: 'PUT', token: a.token, input: { slots } })).status, 200);
    assert.deepEqual(await f.request('/api/player/team', { token: again.token }), { status: 200, body: { slots } });
    assert.deepEqual(await f.request('/api/player/team', { token: b.token }), { status: 200, body: { slots: null } });
    assert.deepEqual(collections.get('players').get(a.user.id).slots, slots);
    assert.equal(collections.get('users').size, 2);
    assert.equal(collections.get('players').size, 2);
    assert.equal(collections.get('sessions').size, 3);
    assert.ok(commands.some(command => command.createIndexes === 'users' && command.indexes[0].unique));
    assert.ok(commands.some(command => command.createIndexes === 'sessions' && command.indexes[0].expireAfterSeconds === 0));
    const persisted = JSON.stringify([...collections].map(([name, docs]) => [name, [...docs.values()]]));
    for (const secret of [password, a.token, b.token, again.token]) assert.ok(!persisted.includes(secret));
    assert.deepEqual(await f.request('/api/auth/me', { token: again.token }), { status: 200, body: { user: a.user, expiresAt: again.expiresAt } });
    assert.deepEqual(await f.request('/api/auth/logout', { method: 'POST', token: a.token }), { status: 200, body: { ok: true } });
    assert.equal((await f.request('/api/player/team', { token: a.token })).status, 401);
    const digest = createHash('sha256').update(again.token).digest('hex');
    collections.get('sessions').get(digest).expiresAt = new Date(0);
    assert.deepEqual(await f.request('/api/auth/me', { token: again.token }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
    assert.equal(await store.revokeSession(again.token), false);
    assert.equal((await f.request('/api/player/team', { token: again.token })).status, 401);
    for (const { query } of queries.filter(query => query.name === 'sessions')) assert.ok(query.expiresAt.$gt instanceof Date);
  } finally { await f.close(); await assets.cleanup(); await store.close(); }
});

test('password UTF-8 is preserved when a multibyte character crosses HTTP chunks', async () => {
  const f = await running();
  try {
    const pass = 'preserve é文字 password  ';
    const bytes = Buffer.from(JSON.stringify({ username: 'unicode_user', password: pass }));
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    const registered = await new Promise((resolve, reject) => {
      const request = httpRequest(f.url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.write(bytes.subarray(0, split));
      setTimeout(() => request.end(bytes.subarray(split)), 30);
    });
    assert.equal(registered.status, 201);
    const result = await login(f, 'unicode_user', pass);
    assert.equal(result.status, 200, 'login uses the exact password supplied at registration');
    assert.deepEqual(Object.keys(result.body).sort(), ['expiresAt', 'token', 'user']);
    assert.deepEqual(Object.keys(result.body.user).sort(), ['id', 'username']);
    assert.equal((await login(f, 'unicode_user', pass.trim())).status, 401, 'password whitespace is not trimmed');
  } finally { await f.close(); }
});

test('account sessions share stable userId teams while A/B and legacy anonymous teams stay isolated', async () => {
  const assets = await fixture();
  const f = await running({ publicRoot: assets.publicRoot });
  try {
    const anonymous = (await f.request('/api/session', { method: 'POST', input: {} })).body.token;
    const slots = ['hero', ...Array(15).fill(null)];
    assert.equal((await f.request('/api/player/team', { method: 'PUT', token: anonymous, input: { slots } })).status, 200);
    const a = (await register(f, 'account_a')).body;
    const b = (await register(f, 'account_b')).body;
    assert.deepEqual(await f.request('/api/player/team', { token: a.token }), { status: 200, body: { slots: null } }, 'no legacy team import');
    const again = (await login(f, 'ACCOUNT_A')).body;
    assert.equal((await f.request('/api/player/team', { method: 'PUT', token: a.token, input: { slots } })).status, 200);
    assert.deepEqual(await f.request('/api/player/team', { token: again.token }), { status: 200, body: { slots } });
    assert.deepEqual(await f.request('/api/player/team', { token: b.token }), { status: 200, body: { slots: null } });
    assert.deepEqual(await f.request('/api/player/team', { token: anonymous }), { status: 200, body: { slots } });
    assert.equal((await f.request('/api/auth/me', { token: anonymous })).status, 401);
    assert.equal((await f.request('/api/session', { method: 'POST', input: { token: a.token } })).status, 401, 'auth tokens are not legacy sessions');
    assert.deepEqual(f.store.players.get(a.user.id).slots, slots);
    await f.request('/api/auth/logout', { method: 'POST', token: a.token });
    assert.deepEqual(await f.request('/api/player/team', { token: a.token }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
    const digest = createHash('sha256').update(again.token).digest('hex');
    f.store.sessions.get(digest).expiresAt = new Date(0);
    assert.deepEqual(await f.request('/api/player/team', { method: 'PUT', token: again.token, input: { slots } }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
  } finally { await f.close(); await assets.cleanup(); }
});

test('every auth API is database guarded and never creates fallback accounts', async () => {
  const f = await running();
  f.store.healthy = async () => false;
  try {
    for (const [route, method] of [['register', 'POST'], ['login', 'POST'], ['me', 'GET'], ['logout', 'POST']]) {
      assert.deepEqual(await f.request('/api/auth/' + route, { method }), { status: 503, body: { error: 'DATABASE_UNAVAILABLE' } });
    }
    assert.equal(f.store.users.size, 0);
    assert.equal(f.store.sessions.size, 0);
  } finally { await f.close(); }
});

test('Mongo readiness awaits unique username and session TTL indexes after ping', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const commands = [];
  const db = { async command(command) { commands.push(command); if (command.createIndexes === 'sessions') await gate; } };
  const store = new MongoStore({ clientFactory: async () => ({ connect: async () => {}, db: () => db, close: async () => {} }) });
  const connection = store.connect({ uri: 'mongodb://test.invalid', database: 'auth_test' });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.db, undefined, 'database must not be published while indexes are pending');
    assert.equal(await store.healthy(), false);
    assert.deepEqual(commands, [
      { ping: 1 },
      { createIndexes: 'users', indexes: [{ key: { username: 1 }, name: 'unique_username', unique: true }] },
      { createIndexes: 'sessions', indexes: [{ key: { expiresAt: 1 }, name: 'session_expiry', expireAfterSeconds: 0 }] },
    ]);
    release();
    await connection;
    assert.equal(await store.healthy(), true);
  } finally { release(); await connection; await store.close(); }
});

test('wrong and unknown credentials are uniform; unknown accounts still perform configured real scrypt', async () => {
  const store = new MemoryStore();
  const calls = [];
  const auth = createAuth(store, { deriveKey: async (...args) => { calls.push(args); return promisify(scrypt)(...args); } });
  const f = await running({ store, auth });
  try {
    await register(f);
    for (const [name, pass] of [['player_one', 'incorrect password'], ['unknown', password], ['player_one', 'short'], ['a.b', password]]) {
      assert.deepEqual(await login(f, name, pass), { status: 401, body: { error: 'INVALID_CREDENTIALS' } });
    }
    assert.equal(calls.length, 3, 'register, known wrong password, and unknown valid username each hash once');
    for (const [, salt, bytes, options] of calls) {
      assert.equal(salt.length, 16);
      assert.equal(bytes, 64);
      assert.deepEqual(options, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    }
    for (const input of [null, [], 7, 'text']) assert.equal((await f.request('/api/auth/login', { method: 'POST', input })).status, 400);
  } finally { await f.close(); }
});

test('two simultaneous expensive hashes are admitted; a third returns AUTH_BUSY instead of queuing', async () => {
  const store = new MemoryStore();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered = 0;
  const auth = createAuth(store, { deriveKey: async (...args) => { entered++; await gate; return promisify(scrypt)(...args); } });
  const first = auth.register({ username: 'first_user', password });
  const second = auth.register({ username: 'second_user', password });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entered, 2);
    await assert.rejects(auth.register({ username: 'third_user', password }), { status: 503, code: 'AUTH_BUSY' });
  } finally { release(); await Promise.allSettled([first, second]); }
  assert.equal((await auth.login({ username: 'first_user', password }, '127.0.0.1')).user.username, 'first_user');
});

test('register throttles duplicate hashing by socket IP despite forwarded headers, separately from login', async () => {
  let now = Date.now();
  let hashes = 0;
  const store = new MemoryStore();
  const auth = createAuth(store, { now: () => now, deriveKey: async () => { hashes++; return Buffer.alloc(64); } });
  const f = await running({ store, auth });
  try {
    for (let i = 0; i < 10; i++) {
      const result = await f.request('/api/auth/register', { method: 'POST', input: { username: i % 2 ? 'DUPLICATE' : 'duplicate', password }, headers: { 'X-Forwarded-For': `192.0.2.${i}` } });
      assert.equal(result.status, i === 0 ? 201 : 409);
    }
    assert.equal(hashes, 10);
    assert.deepEqual(await register(f, 'different_user'), { status: 429, body: { error: 'RATE_LIMITED' } });
    assert.equal(hashes, 10, 'rate-limited registration must not enter password hashing');
    assert.equal((await login(f, 'duplicate')).status, 200, 'registration never consumes login attempts');
    now += 60000;
    assert.equal((await register(f, 'different_user')).status, 201);
    assert.equal(hashes, 12);
  } finally { await f.close(); }
});

test('register bounds both throttle maps, normalizes usernames across IPs, and reclaims capacity only on expiry', async () => {
  let now = Date.now();
  let hashes = 0;
  const auth = createAuth(new MemoryStore(), { now: () => now, throttleCapacity: 2, deriveKey: async () => { hashes++; return Buffer.alloc(64); } });
  await auth.register({ username: 'first', password }, 'ip1');
  await auth.register({ username: 'second', password }, 'ip2');
  await assert.rejects(auth.register({ username: 'third', password }, 'ip1'), { status: 429, code: 'RATE_LIMITED' });
  await assert.rejects(auth.register({ username: 'FIRST', password }, 'ip3'), { status: 429, code: 'RATE_LIMITED' });
  assert.equal(hashes, 2, 'neither full map admits new keys or hashes');
  for (let i = 0; i < 9; i++) await assert.rejects(auth.register({ username: i % 2 ? 'FIRST' : 'first', password }, i % 2 ? 'ip1' : 'ip2'), { code: 'ACCOUNT_EXISTS' });
  await assert.rejects(auth.register({ username: 'FIRST', password }, 'ip2'), { status: 429, code: 'RATE_LIMITED' });
  assert.equal(hashes, 11, 'normalized username remains protected across socket IPs');
  now += 59999;
  await assert.rejects(auth.register({ username: 'third', password }, 'ip3'), { code: 'RATE_LIMITED' });
  now++;
  assert.equal((await auth.register({ username: 'third', password }, 'ip3')).user.username, 'third');
  assert.equal(hashes, 12);
});

test('HTTP registration passes only the direct socket IP to auth', async () => {
  const addresses = [];
  const f = await running({ auth: { async register(input, address) { addresses.push(address); return { ok: true }; } } });
  try {
    assert.equal((await f.request('/api/auth/register', { method: 'POST', input: { username: 'socket_user', password }, headers: { 'X-Forwarded-For': '203.0.113.7', Forwarded: 'for=203.0.113.8' } })).status, 201);
    assert.deepEqual(addresses, ['127.0.0.1']);
  } finally { await f.close(); }
});

test('MongoStore recovers partial player provisioning on login before issuing a session and preserves existing teams', async () => {
  const collections = new Map();
  let failPlayerWrite = true;
  const db = {
    async command() {},
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const docs = collections.get(name);
      const find = query => [...docs.values()].find(doc => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? doc[key] > value.$gt : doc[key] === value));
      const beforeWrite = () => { if (name === 'players' && failPlayerWrite) { failPlayerWrite = false; throw new Error('injected player transport failure'); } };
      return {
        async insertOne(doc) { beforeWrite(); docs.set(doc._id, structuredClone(doc)); },
        async findOne(query) { return structuredClone(find(query) || null); },
        async updateOne(query, update, options) {
          beforeWrite();
          let doc = find(query);
          const matchedCount = doc ? 1 : 0;
          if (!doc && options?.upsert) { doc = structuredClone({ ...query, ...update.$setOnInsert }); docs.set(doc._id, doc); }
          if (doc && update.$set) Object.assign(doc, structuredClone(update.$set));
          return { matchedCount };
        },
      };
    },
  };
  const store = new MongoStore({ clientFactory: async () => ({ connect: async () => {}, db: () => db, close: async () => {} }) });
  await store.connect({ uri: 'mongodb://test.invalid', database: 'partial_auth_test' });
  const assets = await fixture();
  const f = await running({ store, publicRoot: assets.publicRoot });
  try {
    assert.deepEqual(await register(f, 'partial_user'), { status: 503, body: { error: 'SERVICE_UNAVAILABLE' } });
    assert.equal(collections.get('users').size, 1, 'account write succeeded before injected player write failure');
    assert.equal(collections.get('players').size, 0);
    assert.equal(collections.get('sessions')?.size || 0, 0, 'failed provisioning must not issue a session');
    const recovered = await login(f, 'partial_user');
    assert.equal(recovered.status, 200);
    assert.equal(collections.get('players').size, 1, 'login repairs the missing player');
    assert.deepEqual(await f.request('/api/player/team', { token: recovered.body.token }), { status: 200, body: { slots: null } });
    const slots = ['hero', ...Array(15).fill(null)];
    assert.equal((await f.request('/api/player/team', { method: 'PUT', token: recovered.body.token, input: { slots } })).status, 200);
    const again = await login(f, 'partial_user');
    assert.equal(again.status, 200);
    assert.deepEqual(await f.request('/api/player/team', { token: again.body.token }), { status: 200, body: { slots } });
    assert.equal(collections.get('players').size, 1);
    assert.equal(collections.get('sessions').size, 2);
  } finally { await f.close(); await assets.cleanup(); await store.close(); }
});

test('login throttle uses normalized usernames and socket IP, ignores forwarded IP, and resets after a minute', async () => {
  let now = Date.now();
  const store = new MemoryStore();
  const auth = createAuth(store, { now: () => now });
  const f = await running({ store, auth });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login(f, `unknown_${i}`, password, { 'X-Forwarded-For': `192.0.2.${i}` })).status, 401);
    assert.deepEqual(await login(f, 'another_user'), { status: 429, body: { error: 'RATE_LIMITED' } });
    now += 60001;
    for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: i % 2 ? 'MIXED' : 'mixed', password }, `198.51.100.${i}`), { code: 'INVALID_CREDENTIALS' });
    await assert.rejects(auth.login({ username: 'Mixed', password }, '203.0.113.1'), { status: 429, code: 'RATE_LIMITED' });
    now += 60001;
    await assert.rejects(auth.login({ username: 'Mixed', password }, '203.0.113.1'), { status: 401, code: 'INVALID_CREDENTIALS' });
  } finally { await f.close(); }
});

test('throttle storage has a finite capacity and reclaims expired entries without evicting active protections', async () => {
  let now = Date.now();
  const auth = createAuth(new MemoryStore(), { now: () => now, throttleCapacity: 2 });
  await assert.rejects(auth.login({ username: 'first', password }, 'ip1'), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(auth.login({ username: 'second', password }, 'ip2'), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(auth.login({ username: 'third', password }, 'ip3'), { status: 429, code: 'RATE_LIMITED' });
  now += 60001;
  await assert.rejects(auth.login({ username: 'third', password }, 'ip3'), { code: 'INVALID_CREDENTIALS' });
});

test('login issues independent sessions; me is public-only; logout revokes one session; expiry is enforced without TTL deletion', async () => {
  const f = await running();
  try {
    const first = (await register(f)).body;
    const logged = await login(f);
    assert.equal(logged.status, 200);
    assert.deepEqual(logged.body.user, first.user);
    assert.notEqual(logged.body.token, first.token);
    const token = logged.body.token;
    assert.deepEqual(await f.request('/api/auth/me', { token }), { status: 200, body: { user: first.user, expiresAt: logged.body.expiresAt } });
    assert.deepEqual(await f.request('/api/auth/logout', { method: 'POST', token }), { status: 200, body: { ok: true } });
    for (const route of ['/api/auth/me', '/api/auth/logout']) {
      const method = route.endsWith('logout') ? 'POST' : 'GET';
      for (const invalid of [token, 'x'.repeat(43), undefined, 'bad']) {
        assert.deepEqual(await f.request(route, { method, token: invalid }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
      }
    }
    assert.equal((await f.request('/api/auth/me', { token: first.token })).status, 200);
    const digest = createHash('sha256').update(first.token).digest('hex');
    f.store.sessions.get(digest).expiresAt = new Date(Date.now() - 1);
    assert.deepEqual(await f.request('/api/auth/me', { token: first.token }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
    assert.deepEqual(await f.request('/api/auth/logout', { method: 'POST', token: first.token }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
  } finally { await f.close(); }
});

test('duplicate canonical usernames return documented ACCOUNT_EXISTS, including concurrent registration', async () => {
  const f = await running();
  try {
    const results = await Promise.all([register(f, 'Race_User'), register(f, 'race_user')]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.deepEqual(results.find(r => r.status === 409).body, { error: 'ACCOUNT_EXISTS' });
    assert.equal(f.store.users.size, 1);
    assert.equal(f.store.players.size, 1);
    assert.equal(f.store.sessions.size, 1);
  } finally { await f.close(); }
});

test('registration rejects invalid usernames, password types/lengths and non-object bodies without storing accounts', async () => {
  const f = await running();
  try {
    const invalid = [null, [], 'text', 42, true, {}, { username: 'ok_name', password: 123456789012 },
      ...['ab', 'x'.repeat(33), 'a.b', ' aaaa', '玩家名'].map(username => ({ username, password })),
      ...['short', 'x'.repeat(129)].map(pass => ({ username: 'valid_name', password: pass }))];
    for (const input of invalid) {
      const result = await f.request('/api/auth/register', { method: 'POST', input });
      assert.equal(result.status, 400, JSON.stringify(input));
    }
    assert.equal(f.store.users.size, 0);
    assert.equal((await register(f, 'A_1', ' '.repeat(12))).status, 201, 'passwords are not trimmed');
    assert.equal((await register(f, 'z'.repeat(32), '😀'.repeat(64))).status, 201, '128 UTF-16 units / 256 UTF-8 bytes accepted');
  } finally { await f.close(); }
});

test('registration creates a canonical account, salted password hash and digest-only seven-day session', async () => {
  const f = await running();
  try {
    const before = Date.now();
    const result = await register(f);
    assert.equal(result.status, 201);
    assert.deepEqual(Object.keys(result.body).sort(), ['expiresAt', 'token', 'user']);
    assert.deepEqual(Object.keys(result.body.user).sort(), ['id', 'username']);
    assert.equal(result.body.user.username, 'player_one');
    assert.match(result.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.parse(result.body.expiresAt) >= before + 7 * 86400000);
    const user = await f.store.findUser('player_one');
    assert.equal(user._id, result.body.user.id);
    assert.match(user.salt, /^[a-f0-9]{32}$/);
    assert.match(user.passwordHash, /^[a-f0-9]{128}$/);
    assert.ok(!JSON.stringify(user).includes(password));
    const digest = createHash('sha256').update(result.body.token).digest('hex');
    const session = f.store.sessions.get(digest);
    assert.equal(session.userId, user._id);
    assert.ok(!JSON.stringify([...f.store.sessions]).includes(result.body.token));
  } finally { await f.close(); }
});
