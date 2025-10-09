import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import path from 'node:path';
import net from 'node:net';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let authProcess;
let authPort;
const CLIENT_ID = 'test-client';
const CLIENT_SECRET = 'super-secret';
const AUDIENCE = 'test-audience';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForReady(proc, matcher, description) {
  let output = '';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${description}. Output so far:\n${output}`
        )
      );
    }, 5000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (matcher.test(output)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(
        new Error(
          `${description} process exited prematurely` + (code !== null ? ` (code ${code})` : '')
        )
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
    };

    proc.on('exit', onExit);
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

async function startAuthServer() {
  authPort = await getFreePort();
  authProcess = spawn(
    process.execPath,
    ['server.js'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(authPort),
        CLIENT_ID,
        CLIENT_SECRET,
        ISSUER: `http://localhost:${authPort}`,
        AUDIENCE,
        ALLOWED_SCOPES: 'file.read file.list',
        TOKEN_TTL: '120'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  await waitForReady(
    authProcess,
    /authorization server ready/i,
    'authorization server'
  );
}

async function stopAuthServer() {
  if (!authProcess) {
    return;
  }
  authProcess.kill('SIGTERM');
  await once(authProcess, 'exit');
  authProcess = undefined;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch (error) {
    throw new Error(`Failed to parse JSON response (${response.status}): ${text}`);
  }
  return { response, body };
}

test.before(async () => {
  await startAuthServer();
});

test.after(async () => {
  await stopAuthServer();
});

test('authorization server exposes metadata and issues JWT access tokens', async (t) => {
  await t.test('health endpoint', async () => {
    const { response, body } = await fetchJson(`http://localhost:${authPort}/healthz`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { status: 'ok' });
  });

  await t.test('openid configuration', async () => {
    const { response, body } = await fetchJson(`http://localhost:${authPort}/.well-known/openid-configuration`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.issuer, `http://localhost:${authPort}`);
    assert.strictEqual(body.token_endpoint, `http://localhost:${authPort}/token`);
    assert.strictEqual(body.jwks_uri, `http://localhost:${authPort}/jwks.json`);
    assert.deepStrictEqual(body.grant_types_supported, ['client_credentials']);
  });

  await t.test('token issuance with client credentials', async () => {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'file.read file.list'
    });

    const { response, body } = await fetchJson(
      `http://localhost:${authPort}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`
        },
        body: form,
        redirect: 'manual'
      }
    );

    assert.strictEqual(response.status, 200);
    assert.ok(body.access_token, 'access_token should be present');
    assert.strictEqual(body.token_type, 'Bearer');
    assert.strictEqual(body.scope, 'file.read file.list');

    const jwks = createRemoteJWKSet(new URL(`http://localhost:${authPort}/jwks.json`));
    const { payload, protectedHeader } = await jwtVerify(body.access_token, jwks, {
      issuer: `http://localhost:${authPort}`,
      audience: AUDIENCE
    });

    assert.strictEqual(payload.sub, CLIENT_ID);
    assert.strictEqual(payload.scope, 'file.read file.list');
    assert.strictEqual(protectedHeader.alg, 'RS256');
  });

  await t.test('invalid client secret returns 401', async () => {
    const basic = Buffer.from(`${CLIENT_ID}:wrong-secret`).toString('base64');
    const form = new URLSearchParams({
      grant_type: 'client_credentials'
    });

    const { response, body } = await fetchJson(
      `http://localhost:${authPort}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`
        },
        body: form
      }
    );

    assert.strictEqual(response.status, 401);
    assert.strictEqual(body.error, 'invalid_client');
  });

  await t.test('unsupported scope is rejected', async () => {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'unknown.scope'
    });

    const { response, body } = await fetchJson(
      `http://localhost:${authPort}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`
        },
        body: form
      }
    );

    assert.strictEqual(response.status, 404);
    assert.strictEqual(body.error, 'invalid_scope');
  });
});
