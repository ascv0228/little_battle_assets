import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './index.mjs';
import { MemoryStore } from './store.mjs';
import { fixture } from '../scripts/publish.test.mjs';

async function running() {
  const f = await fixture();
  const store = new MemoryStore();
  const server = createServer({ publicRoot: f.publicRoot, store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { ...f, store, url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.cleanup(); } };
}

test('real HTTP manifest, sessions, Mongo contract, isolated validated team writes', async () => {
  const f = await running();
  try {
    assert.equal((await fetch(f.url + '/health')).status, 200);
    const manifest = await (await fetch(f.url + '/assets/manifest.json')).json();
    assert.equal(manifest.version, f.manifest.version);
    const asset = await fetch(`${f.url}/assets/releases/${manifest.version}/gameplay/stages.json`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    const postSession = () => fetch(f.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
    const first = await postSession();
    const second = await postSession();
    assert.notEqual(first.token, second.token);
    const catalog = await (await fetch(f.url + '/api/catalog')).json();
    assert.equal(catalog.version, manifest.version);
    assert.equal(catalog.characters[0].id, 'hero');
    const headers = { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' };
    const slots = ['hero', ...Array(15).fill(null)];
    assert.equal((await fetch(f.url + '/api/player/team', { method: 'PUT', headers, body: JSON.stringify({ slots }) })).status, 200);
    assert.deepEqual((await (await fetch(f.url + '/api/player/team', { headers })).json()).slots, slots);
    const other = await (await fetch(f.url + '/api/player/team', { headers: { Authorization: `Bearer ${second.token}` } })).json();
    assert.equal(other.slots, null);
    const invalid = await fetch(f.url + '/api/player/team', { method: 'PUT', headers, body: JSON.stringify({ slots: Array(16).fill('hero') }) });
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(f.url + '/api/player/team')).status, 401);
    assert.equal((await fetch(f.url + '/atlas-credentials.env')).status, 404);
    assert.equal((await fetch(f.url + `/assets/releases/${manifest.version}/characters/a.env`)).status, 404);
    assert.equal((await fetch(f.url + '/assets/%2e%2e%2fatlas-credentials.env')).status, 404);
    assert.equal((await fetch(f.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64) }) })).status, 401);
  } finally { await f.close(); }
});

test('database failure is explicit and never turns into an offline account', async () => {
  const f = await running();
  f.store.healthy = async () => false;
  try {
    assert.equal((await fetch(f.url + '/health')).status, 503);
    assert.equal((await fetch(f.url + '/api/catalog')).status, 503);
    assert.equal((await fetch(f.url + '/assets/manifest.json')).status, 200);
  } finally { await f.close(); }
});
