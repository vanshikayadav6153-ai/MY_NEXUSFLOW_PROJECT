import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'server', 'index.js');

function startServer(env) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env, NEXUSFLOW_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const onData = (buf) => {
      out += buf.toString();
      if (out.includes('Running at http://localhost:')) {
        child.stdout.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => reject(new Error(`server exited early (${code})\n${out}`)));
    setTimeout(() => reject(new Error(`server did not start\n${out}`)), 15000);
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGKILL');
  await once(child, 'exit').catch(() => {});
}

// ---------------------------------------------------------------------------
test('token mode: /api requires a valid bearer token', async (t) => {
  const PORT = 4711;
  const TOKEN = 'test-token-abcdef';
  const child = await startServer({ PORT: String(PORT), NEXUSFLOW_AUTH_TOKEN: TOKEN });
  t.after(() => stop(child));
  const base = `http://127.0.0.1:${PORT}`;

  assert.equal((await fetch(`${base}/api/diagnostics`)).status, 401, 'no token -> 401');
  assert.equal(
    (await fetch(`${base}/api/diagnostics`, { headers: { Authorization: 'Bearer wrong' } })).status,
    401, 'wrong token -> 401'
  );
  assert.equal(
    (await fetch(`${base}/api/diagnostics`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status,
    200, 'right token -> 200'
  );

  // login endpoint is reachable without a token
  const statusRes = await fetch(`${base}/api/auth/status`);
  assert.equal(statusRes.status, 200);
  assert.deepEqual(await statusRes.json(), { authRequired: true });

  const badLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x' })
  });
  assert.equal(badLogin.status, 401);

  const goodLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN })
  });
  assert.equal(goodLogin.status, 200);
});

test('local-only mode: loopback is allowed, config validation still applies', async (t) => {
  const PORT = 4712;
  const child = await startServer({ PORT: String(PORT) }); // no NEXUSFLOW_AUTH_TOKEN
  t.after(() => stop(child));
  const base = `http://127.0.0.1:${PORT}`;

  assert.equal((await fetch(`${base}/api/diagnostics`)).status, 200, 'loopback allowed in local-only mode');

  const bad = await fetch(`${base}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlockPin: '12; rm -rf /' })
  });
  assert.equal(bad.status, 400, 'injection PIN rejected by schema');

  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.unlockPin, '', 'GET /api/config never returns the PIN');
});

test('GET /api/health needs no auth and reports status', async (t) => {
  const PORT = 4713;
  const child = await startServer({ PORT: String(PORT), NEXUSFLOW_AUTH_TOKEN: 'tok' });
  t.after(() => stop(child));
  const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  assert.equal(res.status, 200, 'health is reachable without a token');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.authRequired, true);
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.equal(typeof body.aiEnabled, 'boolean');
});
