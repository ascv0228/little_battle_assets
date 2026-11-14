import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish, safeAssetPath } from './publish.mjs';

export async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'little-battle-'));
  const source = path.join(directory, 'assets');
  const publicRoot = path.join(directory, 'public');
  const data = {
    'gameplay/stages.json': [{ id: 'test' }],
    'gameplay/summons.json': [{ character: 'hero', cost: 80, cooldown: 2 }],
    'props/training_dummy/prop.json': {},
    'characters/hero/character.json': { id: 'hero', faction: 'ALLY', stats: { hp: 100, atk: 20 } }
  };
  for (const [file, value] of Object.entries(data)) {
    const target = path.join(source, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(value));
  }
  await fs.writeFile(path.join(source, '.env'), 'PRIVATE=not-public');
  await fs.mkdir(path.join(source, 'temp_assets'), { recursive: true });
  await fs.writeFile(path.join(source, 'temp_assets', 'raw.png'), 'do not publish');
  const manifest = await publish(source, publicRoot);
  return { directory, source, publicRoot, manifest, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

test('publisher is immutable, deterministic and excludes secrets/raw inputs', async () => {
  const f = await fixture();
  try {
    assert.equal(f.manifest.files.length, 4);
    assert.equal((await publish(f.source, f.publicRoot)).version, f.manifest.version);
    assert.ok(f.manifest.files.every(entry => !entry.path.includes('.env') && !entry.path.includes('temp_assets')));
    await fs.writeFile(path.join(f.source, 'gameplay/stages.json'), '[{"id":"updated"}]');
    const newer = await publish(f.source, f.publicRoot);
    assert.notEqual(newer.version, f.manifest.version);
    assert.ok((await fs.stat(path.join(f.publicRoot, 'releases', f.manifest.version))).isDirectory());
  } finally { await f.cleanup(); }
});

test('paths cannot escape asset content', () => {
  for (const value of ['../.env', '/etc/passwd', 'characters/../private.json', 'server/file.json', 'characters/a.env', 'characters\\a.png', 'characters/%2e%2e/a.json']) assert.equal(safeAssetPath(value), false, value);
});
