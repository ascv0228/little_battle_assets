import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/publish.mjs';

function configWith(overrides = {}) {
  const env = { ...process.env, ENV_FILE: path.join(ROOT, 'server', 'absent-test.env'), ...overrides };
  delete env.PORT;
  delete env.HOST;
  Object.assign(env, overrides);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {loadConfig} from './server/config.mjs'; const {host,port}=loadConfig(); console.log(JSON.stringify({host,port}));"],
  { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('direct application endpoint defaults to loopback port 5000', () => {
  assert.deepEqual(configWith(), { host: '127.0.0.1', port: 5000 });
});

test('explicit application host and port overrides remain supported', () => {
  assert.deepEqual(configWith({ HOST: '127.0.0.1', PORT: '5100' }), { host: '127.0.0.1', port: 5100 });
});

test('public tunnel disables HTTP request introspection for account credentials', () => {
  const tunnel = readFileSync(path.join(ROOT, 'deploy/start-tunnel.bat'), 'utf8');
  assert.match(tunnel, /--inspect=false/);
});

test('deployment scripts run the application directly without a proxy dependency', () => {
  const start = readFileSync(path.join(ROOT, 'deploy/start-local.bat'), 'utf8');
  const stop = readFileSync(path.join(ROOT, 'deploy/stop-local.bat'), 'utf8');
  assert.doesNotMatch(start + stop, /nginx/i);
  assert.match(start, /set "HOST=127\.0\.0\.1"/);
  assert.match(start, /set "PORT=5000"/);
  assert.match(start, /npm start/);
  assert.equal(existsSync(path.join(ROOT, 'deploy/nginx.local.conf')), false);
});
