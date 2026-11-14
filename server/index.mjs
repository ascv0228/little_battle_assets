import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeAssetPath } from '../scripts/publish.mjs';
import { loadConfig } from './config.mjs';
import { MongoStore } from './store.mjs';
import { loadCatalog } from './catalog.mjs';

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };

async function body(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
  let value = '';
  for await (const chunk of request) { value += chunk; if (Buffer.byteLength(value) > 65536) throw new HttpError(413, 'BODY_TOO_LARGE'); }
  try { return JSON.parse(value); } catch { throw new HttpError(400, 'INVALID_JSON'); }
}

function token(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(request.headers.authorization || '');
  if (!match) throw new HttpError(401, 'AUTH_REQUIRED');
  return match[1];
}

export function validateTeam(slots, catalog) {
  const allowed = new Set(catalog.summons.map(o => o.character));
  if (!Array.isArray(slots) || slots.length !== 16) throw new HttpError(400, 'TEAM_NEEDS_16_SLOTS');
  const selected = slots.filter(id => id !== null);
  if (!selected.length || selected.some(id => typeof id !== 'string' || !allowed.has(id)) || new Set(selected).size !== selected.length) throw new HttpError(400, 'INVALID_TEAM');
}

export function createServer({ publicRoot, store, allowedOrigins = [] }) {
  return http.createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      } else if (origin && !(request.url || '').startsWith('/assets/')) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') {
        const database = await store.healthy();
        let assets = true;
        try { await fs.access(path.join(publicRoot, 'manifest.json')); } catch { assets = false; }
        json(response, database && assets ? 200 : 503, { ok: database && assets, database: database ? 'connected' : 'unavailable', assets }); return;
      }
      if (url.pathname.startsWith('/assets/') && ['GET', 'HEAD'].includes(request.method)) {
        let relative;
        try { relative = decodeURIComponent(url.pathname.slice(8)); } catch { throw new HttpError(400, 'INVALID_PATH'); }
        if (relative !== 'manifest.json') {
          const parts = relative.split('/');
          if (parts[0] !== 'releases' || !/^[a-f0-9]{64}$/.test(parts[1] || '') || !safeAssetPath(parts.slice(2).join('/'))) throw new HttpError(404, 'NOT_FOUND');
        }
        const file = path.join(publicRoot, ...relative.split('/'));
        let resolved;
        try { resolved = await fs.realpath(file); } catch { throw new HttpError(404, 'NOT_FOUND'); }
        const root = await fs.realpath(publicRoot);
        if (!resolved.startsWith(root + path.sep)) throw new HttpError(404, 'NOT_FOUND');
        const bytes = await fs.readFile(resolved);
        const type = { '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': relative === 'manifest.json' ? 'no-store' : 'public, max-age=31536000, immutable' });
        response.end(request.method === 'HEAD' ? undefined : bytes); return;
      }
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'NOT_FOUND');
      if (!await store.healthy()) throw new HttpError(503, 'DATABASE_UNAVAILABLE');
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const input = await body(request);
        if (input.token !== undefined && (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(input.token))) throw new HttpError(400, 'INVALID_TOKEN');
        const sessionToken = await store.session(input.token);
        if (!sessionToken) throw new HttpError(401, 'UNKNOWN_SESSION');
        json(response, 200, { token: sessionToken }); return;
      }
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        json(response, 200, await store.catalog(await loadCatalog(publicRoot))); return;
      }
      if (url.pathname === '/api/player/team' && ['GET', 'PUT'].includes(request.method)) {
        const bearer = token(request);
        const player = await store.player(bearer);
        if (!player) throw new HttpError(401, 'UNKNOWN_SESSION');
        if (request.method === 'GET') { json(response, 200, { slots: player.slots }); return; }
        const input = await body(request);
        validateTeam(input.slots, await store.catalog(await loadCatalog(publicRoot)));
        if (!await store.saveTeam(bearer, input.slots)) throw new HttpError(401, 'UNKNOWN_SESSION');
        json(response, 200, { slots: input.slots }); return;
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 503, { error: error.code && error.status ? error.code : 'SERVICE_UNAVAILABLE' });
      else response.end();
    }
  });
}

async function main() {
  const config = loadConfig();
  const store = new MongoStore();
  try { await store.connect(config); console.log('MongoDB connected.'); }
  catch { console.error('MongoDB unavailable. Check private environment configuration, network and Atlas access rules.'); }
  const server = createServer({ ...config, store });
  server.listen(config.port, config.host, () => console.log(`Little Battle Node service: http://${config.host}:${config.port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
