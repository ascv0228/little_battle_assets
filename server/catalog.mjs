import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hash, safeAssetPath } from '../scripts/publish.mjs';

export async function loadCatalog(publicRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(publicRoot, 'manifest.json'), 'utf8'));
  if (manifest.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.version)) throw new Error('Invalid release');
  const files = new Map(manifest.files.map(f => [f.path, f]));
  async function read(name) {
    if (!safeAssetPath(name) || !files.has(name)) throw new Error('Missing catalog file');
    const bytes = await fs.readFile(path.join(publicRoot, 'releases', manifest.version, ...name.split('/')));
    if (hash(bytes) !== files.get(name).sha256) throw new Error('Catalog checksum mismatch');
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  }
  const characters = [];
  for (const entry of manifest.files) if (entry.path.startsWith('characters/') && entry.path.endsWith('/character.json')) characters.push(await read(entry.path));
  return { schema_version: 1, version: manifest.version, characters,
    stages: await read('gameplay/stages.json'), summons: await read('gameplay/summons.json') };
}
