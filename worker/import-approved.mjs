import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { ROOT, safeRelative, sha256, fetchBytes, atomicJson, isMain, validateRemoteUrl } from './common.mjs';

export function validateDescriptor(descriptor) {
  if (descriptor.schema_version !== 1 || !/^[a-z][a-z0-9_]{2,79}$/.test(descriptor.character?.id || '')) throw new Error('Invalid character descriptor');
  const source = descriptor.source;
  if (!source?.author || !source.license?.reviewed_by || !source.license.reviewed_at || !source.license.id || source.license.game_use !== true || source.license.asset_redistribution !== true) throw new Error('Explicit reviewed game-use AND asset-redistribution permission is required');
  validateRemoteUrl(source.page_url); validateRemoteUrl(source.license.evidence_url);
  if (!Array.isArray(source.downloads) || !source.downloads.length || source.downloads.length > 30) throw new Error('Invalid source downloads');
  const destinations = new Set();
  for (const file of source.downloads) {
    validateRemoteUrl(file.url);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !['png','zip'].includes(file.format)) throw new Error('Download requires pinned SHA256 and supported format');
    const outputs = file.format === 'zip' ? file.extract : [{ destination: file.destination }];
    if (!Array.isArray(outputs) || !outputs.length || outputs.length > 100) throw new Error('Archive needs an explicit entry allowlist');
    for (const output of outputs) {
      safeRelative(output.destination);
      if (!output.destination.endsWith('.png') || destinations.has(output.destination)) throw new Error('Only unique PNG destinations are accepted');
      if (file.format === 'zip') safeRelative(output.entry);
      destinations.add(output.destination);
    }
  }
  const c = descriptor.character;
  if (!['character','monster'].includes(c.type) || !['ALLY','ENEMY'].includes(c.faction) || c.behavior?.type !== 'advance_and_area_attack') throw new Error('Unsupported game behavior');
  for (const key of ['hp','atk','attack_range','attack_interval']) if (!(Number.isFinite(c.stats?.[key]) && c.stats[key] > 0)) throw new Error('Invalid combat stats');
  if (!Number.isFinite(c.stats.defense) || c.stats.defense < 0 || !Array.isArray(c.equipment) || c.equipment.some(g => !Number.isFinite(g.defense) || g.defense < 0)) throw new Error('Invalid armor stats');
  for (const key of ['move_speed','hit_time','death_fade_seconds']) if (!Number.isFinite(c.behavior[key]) || c.behavior[key] < 0) throw new Error('Invalid behavior timing');
  if (!['walk','attack','death'].every(state => descriptor.animations?.[state])) throw new Error('Walk, attack and death frame maps are required');
  for (const spec of Object.values(descriptor.animations)) {
    for (const key of ['source_frame_size','output_frame_size']) if (!Array.isArray(spec[key]) || spec[key].length !== 2 || spec[key].some(n => !Number.isInteger(n) || n < 1 || n > 2048)) throw new Error('Invalid frame dimensions');
    if (!Array.isArray(spec.durations) || !spec.durations.length || spec.durations.length > 128 || spec.durations.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid animation durations');
    for (const key of ['anchor','label_offset']) if (!Array.isArray(spec[key]) || spec[key].length !== 2 || spec[key].some(n => !Number.isFinite(n))) throw new Error('Invalid animation anchor');
    if (typeof spec.loop !== 'boolean' || !Array.isArray(spec.layers) || !spec.layers.length || spec.layers.length > 30) throw new Error('Invalid animation layers');
    for (const layer of spec.layers) {
      if (!destinations.has(safeRelative(layer.file)) || !Number.isInteger(layer.row) || layer.row < 0 || !Array.isArray(layer.columns) || layer.columns.length !== spec.durations.length || layer.columns.some(n => !Number.isInteger(n) || n < 0)) throw new Error('Invalid or unmapped animation source');
    }
  }
  const attackDuration = descriptor.animations.attack.durations.reduce((a,b) => a+b,0);
  if (attackDuration > c.stats.attack_interval || c.behavior.hit_time >= attackDuration) throw new Error('Attack timing is outside the mapped animation');
  return destinations;
}

export function readZipEntries(bytes) {
  if (bytes.length < 22) throw new Error('Invalid ZIP');
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) if (bytes.readUInt32LE(pos) === 0x06054b50) { end = pos; break; }
  if (end < 0 || bytes.readUInt16LE(end+4) || bytes.readUInt16LE(end+6)) throw new Error('Unsupported ZIP');
  const count = bytes.readUInt16LE(end+10), offset = bytes.readUInt32LE(end+16);
  if (count > 2000) throw new Error('Too many ZIP entries');
  let cursor = offset; const entries = new Map(); let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = bytes.readUInt16LE(cursor+8), method = bytes.readUInt16LE(cursor+10), compressed = bytes.readUInt32LE(cursor+20), size = bytes.readUInt32LE(cursor+24);
    const nameLength = bytes.readUInt16LE(cursor+28), extra = bytes.readUInt16LE(cursor+30), comment = bytes.readUInt16LE(cursor+32), attrs = bytes.readUInt32LE(cursor+38), local = bytes.readUInt32LE(cursor+42);
    const name = bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    cursor += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) { safeRelative(name.slice(0,-1)); continue; }
    safeRelative(name);
    if (entries.has(name) || flags & 1 || ![0,8].includes(method) || ((attrs >>> 16) & 0xf000) === 0xa000) throw new Error('Unsupported, duplicate or symbolic ZIP entry');
    total += size;
    if (size > 32*1024*1024 || total > 128*1024*1024 || (compressed && size/compressed > 1000)) throw new Error('ZIP expansion limit exceeded');
    if (local+30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid local ZIP entry');
    const start = local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if (start+compressed > offset) throw new Error('ZIP entry exceeds archive data');
    const compressedBytes = bytes.subarray(start,start+compressed);
    const data = method === 0 ? compressedBytes : inflateRawSync(compressedBytes,{maxOutputLength:32*1024*1024});
    if (data.length !== size) throw new Error('ZIP expanded size mismatch');
    entries.set(name,data);
  }
  return entries;
}

export function pngSize(bytes) {
  if (bytes.length < 33 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12,16).toString() !== 'IHDR') throw new Error('Not a PNG image');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768 || width * height > 64*1024*1024) throw new Error('PNG dimensions too large');
  return [width,height];
}

export async function importApproved(descriptor, { root = ROOT, download = fetchBytes, dryRun = false } = {}) {
  validateDescriptor(descriptor);
  const id = descriptor.character.id;
  const target = path.join(root,'temp_assets','imported',id), recipePath = path.join(root,'asset_sources','characters',`${id}.json`);
  for (const p of [target,recipePath]) {
    try { await fs.access(p); throw new Error('Existing source or character will not be overwritten'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const outputs = new Map();
  const downloads = [];
  for (const file of descriptor.source.downloads) {
    const bytes = await download(file.url);
    if (sha256(bytes) !== file.sha256) throw new Error('Source SHA256 mismatch');
    downloads.push({ name: `${downloads.length}-${file.sha256}.${file.format}`, bytes });
    if (file.format === 'png') { pngSize(bytes); outputs.set(file.destination,bytes); }
    else {
      const archive = readZipEntries(bytes);
      for (const item of file.extract) {
        const png = archive.get(item.entry);
        if (!png) throw new Error('Mapped archive entry missing');
        pngSize(png); outputs.set(item.destination,png);
      }
    }
  }
  for (const spec of Object.values(descriptor.animations)) for (const layer of spec.layers) {
    const [width,height] = pngSize(outputs.get(layer.file));
    if (layer.columns.some(c => (c+1)*spec.source_frame_size[0] > width) || (layer.row+1)*spec.source_frame_size[1] > height) throw new Error('Frame map exceeds downloaded sheet');
  }
  if (dryRun) return { id, files: [...outputs.keys()], imported:false, validated:true };
  const staging = path.join(root,'temp_assets','imports',`${id}-${process.pid}`);
  await fs.mkdir(staging,{recursive:true});
  try {
    await fs.mkdir(path.join(staging,'downloads'),{recursive:true});
    for (const file of downloads) await fs.writeFile(path.join(staging,'downloads',file.name),file.bytes,{flag:'wx'});
    for (const [relative,data] of outputs) { const p=path.join(staging,relative); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,data,{flag:'wx'}); }
    await atomicJson(path.join(staging,'provenance.json'),{schema_version:1,...descriptor.source,imported_at:new Date().toISOString()});
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.rename(staging,target);
    await atomicJson(recipePath,{source_root:`temp_assets/imported/${id}`,character:descriptor.character,animations:descriptor.animations,source:descriptor.source,notes:[...(descriptor.notes || []),`Source: ${descriptor.source.page_url}; author: ${descriptor.source.author}; license: ${descriptor.source.license.id}`]});
  } catch (error) { await fs.rm(staging,{recursive:true,force:true}); throw error; }
  return { id,files:[...outputs.keys()],imported:true,validated:true };
}

if (isMain(import.meta.url)) {
  try {
    const descriptorPath = process.argv[2];
    if (!descriptorPath) throw new Error('Usage: node worker/import-approved.mjs descriptor.json [--dry-run]');
    const descriptor = JSON.parse(await fs.readFile(descriptorPath,'utf8'));
    console.log(JSON.stringify(await importApproved(descriptor,{dryRun:process.argv.includes('--dry-run')})));
  } catch(error) { console.error(`Approved import stopped: ${String(error.message).slice(0,200)}`); process.exitCode=1; }
}
