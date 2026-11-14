import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function safeRelative(value) {
  if (typeof value !== 'string' || value.length > 240 || value.includes('\\') || value.includes('\0') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe relative path');
  return value;
}

export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
    return !(lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower) || lower.startsWith('ff'));
  }
  return false;
}

export function validateRemoteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hostname === 'localhost' || url.hash) throw new Error('Only public HTTPS URLs are accepted');
  if (net.isIP(url.hostname) && !isPublicAddress(url.hostname)) throw new Error('Private network URL rejected');
  return url;
}

export async function fetchBytes(value, { limit = 32 * 1024 * 1024, fetchImpl = fetch, dnsLookup = lookup } = {}) {
  let url = validateRemoteUrl(value);
  for (let redirect = 0; redirect < 5; redirect++) {
    const addresses = await dnsLookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Private or unresolved download host rejected');
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'LittleBattleAssetDiscovery/1.0 (+asset provenance audit)' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect missing destination');
      await response.body?.cancel();
      url = validateRemoteUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Download too large');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('Download too large'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many redirects');
}

export async function atomicJson(destination, value) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temporary, destination);
}

export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}
