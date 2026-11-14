import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, sha256, fetchBytes, atomicJson, isMain, validateRemoteUrl } from './common.mjs';

const decode = text => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, '').trim();
const tag = (item, name) => decode(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');

export function parseFeed(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported RSS input');
  const found = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    if (found.length >= 100) break;
    const source = tag(match[1], 'link');
    let url;
    try { url = validateRemoteUrl(source); } catch { continue; }
    if (!(url.hostname === 'itch.io' || url.hostname.endsWith('.itch.io'))) continue;
    found.push({ id: sha256(url.href).slice(0,24), source_url: url.href, title: tag(match[1], 'title').slice(0,300), author: (tag(match[1], 'dc:creator') || url.hostname.split('.')[0]).slice(0,200), status: 'quarantined', license: null, reason: 'Free price is not license permission. Review game-use and public asset-redistribution terms plus a frame-map descriptor before import.' });
  }
  return found;
}

export async function discover({ configPath = path.join(ROOT, 'config', 'discovery.json'), outputPath = path.join(ROOT, 'data', 'discovery', 'candidates.json'), download = fetchBytes } = {}) {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const now = new Date().toISOString();
  let previous = { candidates: [] };
  try { previous = JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const items = new Map(previous.candidates.map(item => [item.source_url, item]));
  const feeds = [];
  for (const feed of config.feeds) {
    const url = validateRemoteUrl(feed);
    if (url.hostname !== 'itch.io' || !url.pathname.endsWith('.xml')) throw new Error('Discovery only accepts official itch.io RSS browse feeds');
    try {
      const bytes = await download(url.href, { limit: 2 * 1024 * 1024 });
      const candidates = parseFeed(bytes.toString('utf8'));
      for (const item of candidates) {
        const old = items.get(item.source_url);
        items.set(item.source_url, { ...item, first_seen: old?.first_seen || now, last_seen: now, found_in: [...new Set([...(old?.found_in || []), feed])] });
      }
      feeds.push({ url: feed, status: 'ok', found: candidates.length });
    } catch (error) {
      feeds.push({ url: feed, status: 'failed', error: String(error.message).slice(0,160) });
    }
  }
  const report = { schema_version: 1, checked_at: now, feeds, candidates: [...items.values()].sort((a,b) => a.id.localeCompare(b.id)) };
  await atomicJson(outputPath, report);
  return report;
}

if (isMain(import.meta.url)) {
  try {
    const report = await discover();
    console.log(JSON.stringify({ candidates: report.candidates.length, feeds: report.feeds.map(f => ({ status: f.status, found: f.found || 0 })) }));
    if (report.feeds.every(f => f.status !== 'ok')) process.exitCode = 1;
  } catch { console.error('Asset discovery failed. Check the config and network; no assets were published.'); process.exitCode = 1; }
}
