import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const groups = new Set(['characters', 'gameplay', 'props', 'credits']);
const extensions = new Set(['.png', '.json', '.txt', '.md']);

export function safeAssetPath(value) {
  if (typeof value !== 'string' || !value || /[\\:%\x00]/.test(value) || value.startsWith('/')) return false;
  const parts = value.split('/');
  return parts.every(p => p && !p.startsWith('.') && p !== '..') && groups.has(parts[0]) && extensions.has(path.posix.extname(value).toLowerCase());
}

async function collect(directory, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not publishable');
    if (entry.name.startsWith('.') || /\.env(?:\.|$)/i.test(entry.name)) continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (!relative && !groups.has(entry.name)) continue;
    if (entry.isDirectory()) result.push(...await collect(path.join(directory, entry.name), name));
    else if (safeAssetPath(name)) {
      const bytes = await fs.readFile(path.join(directory, entry.name));
      if (bytes.length > 128 * 1024 * 1024) throw new Error('Asset is too large');
      result.push({ path: name, size: bytes.length, sha256: hash(bytes) });
    }
  }
  return result;
}

export async function publish(source = path.join(ROOT, 'assets'), output = path.join(ROOT, 'public')) {
  if (path.resolve(source) === path.join(ROOT, 'assets')) {
    // Authored configuration is versioned separately from generated atlas output.
    for (const group of ['gameplay', 'credits']) {
      const input = path.join(ROOT, 'config', group);
      try {
        await fs.access(input);
        await fs.mkdir(path.join(source, group), { recursive: true });
        for (const entry of await fs.readdir(input, { withFileTypes: true })) {
          if (entry.isFile() && !entry.name.startsWith('.')) await fs.copyFile(path.join(input, entry.name), path.join(source, group, entry.name));
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const files = (await collect(source)).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const names = new Set(files.map(f => f.path));
  for (const required of ['gameplay/stages.json', 'gameplay/summons.json', 'props/training_dummy/prop.json']) {
    if (!names.has(required)) throw new Error(`Missing asset: ${required}`);
  }
  if (!files.some(f => f.path.startsWith('characters/') && f.path.endsWith('/character.json'))) throw new Error('No characters');
  const version = hash(Buffer.from(JSON.stringify(files)));
  const destination = path.join(output, 'releases', version);
  for (const entry of files) {
    const target = path.join(destination, ...entry.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const bytes = await fs.readFile(path.join(source, ...entry.path.split('/')));
    if (hash(bytes) !== entry.sha256) throw new Error('Source changed while publishing');
    try {
      if (hash(await fs.readFile(target)) !== entry.sha256) throw new Error('Immutable asset already differs');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.writeFile(target, bytes, { flag: 'wx' });
    }
  }
  const manifest = { schema_version: 1, version, files };
  await fs.mkdir(output, { recursive: true });
  const temporary = path.join(output, `manifest.${process.pid}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(temporary, path.join(output, 'manifest.json'));
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await publish(process.argv[2] && path.resolve(process.argv[2]), process.argv[3] && path.resolve(process.argv[3]));
  console.log(`Published ${result.files.length} asset files; version ${result.version}`);
}
