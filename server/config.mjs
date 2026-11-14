import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/publish.mjs';

export function loadConfig() {
  const envFile = process.env.ENV_FILE || [path.join(ROOT, '.env'), path.join(ROOT, 'atlas-credentials.env')].find(existsSync);
  if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
  let uri = process.env.MONGODB_URI || '';
  for (const name of ['db_username', 'username']) uri = uri.replaceAll(`<${name}>`, encodeURIComponent(process.env.MONGODB_USERNAME || ''));
  for (const name of ['db_password', 'password']) uri = uri.replaceAll(`<${name}>`, encodeURIComponent(process.env.MONGODB_PASSWORD || ''));
  return { uri, database: process.env.MONGODB_DATABASE || 'little_battle',
    host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 8787),
    publicRoot: path.resolve(process.env.PUBLIC_ROOT || path.join(ROOT, 'public')),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) };
}
