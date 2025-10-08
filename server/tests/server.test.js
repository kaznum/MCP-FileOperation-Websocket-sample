import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { WebSocket } from 'ws';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

let jwksServer;
let jwksPort;
let privateKey;
let mcpProcess;
let serverPort;

const REQUIRED_SCOPES = 'file.read file.list';
const KEY_ID = 'test-key';

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

async function startJwksServer() {
  const { publicKey, privateKey: signer } = await generateKeyPair('RS256', { modulusLength: 2048 });
  privateKey = signer;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KEY_ID;
  jwk.use = 'sig';
  jwk.alg = 'RS256';

  jwksServer = http.createServer((req, res) => {
    if (req.url === '/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  jwksPort = await new Promise((resolve, reject) => {
    jwksServer.listen(0, () => {
      const address = jwksServer.address();
      resolve(address.port);
    });
    jwksServer.on('error', reject);
  });
}

function stopJwksServer() {
  if (!jwksServer) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    jwksServer.close(() => {
      jwksServer = undefined;
      resolve();
    });
  });
}

async function waitForOutput(proc, matcher, description) {
  let buffer = '';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${description}. Output so far:\n${buffer}`
        )
      );
    }, 8000);

    const onData = (chunk) => {
      buffer += chunk.toString();
      if (matcher.test(buffer)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(
        new Error(
          `${description} process exited early` + (code !== null ? ` (code ${code})` : '')
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

async function startMcpServer() {
  serverPort = await getFreePort();
  mcpProcess = spawn(
    process.execPath,
    ['server.js'],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        PORT: String(serverPort),
        TARGET_DIR: path.resolve(serverDir, '..', 'data'),
        OAUTH_JWKS_URL: `http://localhost:${jwksPort}/jwks.json`,
        OAUTH_ISSUER: `http://localhost:${jwksPort}`,
        OAUTH_AUDIENCE: 'mcp-server',
        OAUTH_REQUIRED_SCOPES: REQUIRED_SCOPES
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  await waitForOutput(mcpProcess, /MCP Server listening on port/i, 'MCP server');
}

async function stopMcpServer() {
  if (!mcpProcess) {
    return;
  }
  mcpProcess.kill('SIGTERM');
  await once(mcpProcess, 'exit').catch(() => {});
  mcpProcess = undefined;
}

function createAccessToken(scope = REQUIRED_SCOPES) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(`http://localhost:${jwksPort}`)
    .setAudience('mcp-server')
    .setSubject('test-client')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);
}

function openWebSocket(headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${serverPort}`, { headers });

    const timeout = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error('Timed out waiting for WebSocket connection'));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('open', onOpen);
      socket.off('error', onError);
    };

    const onOpen = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

test.before(async () => {
  await startJwksServer();
  await startMcpServer();
});

test.after(async () => {
  await stopMcpServer();
  await stopJwksServer();
});

test('MCP server enforces OAuth 2.1 authentication', async (t) => {
  await t.test('accepts valid access token and responds to initialize', async () => {
    const token = await createAccessToken();
    const ws = await openWebSocket({
      Authorization: `Bearer ${token}`
    });

    ws.send(JSON.stringify({ type: 'initialize' }));

    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for initialized response'));
      }, 3000);

      const onMessage = (data) => {
        cleanup();
        resolve(data.toString());
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.off('message', onMessage);
        ws.off('error', onError);
      };

      ws.once('message', onMessage);
      ws.once('error', onError);
    });

    const payload = JSON.parse(message);
    assert.strictEqual(payload.type, 'initialized');
    assert.strictEqual(payload.serverInfo?.name, 'file-operations-mcp');

    ws.close();
    await once(ws, 'close');
  });

  await t.test('rejects missing bearer token', async () => {
    await assert.rejects(
      openWebSocket(),
      /Unexpected server response: 401/
    );
  });

  await t.test('rejects token missing required scopes', async () => {
    const token = await createAccessToken('file.read'); // missing file.list
    await assert.rejects(
      openWebSocket({
        Authorization: `Bearer ${token}`
      }),
      /Unexpected server response: 401/
    );
  });

  await t.test('rejects invalid bearer token', async () => {
    await assert.rejects(
      openWebSocket({
        Authorization: 'Bearer invalid-token'
      }),
      /Unexpected server response: 401/
    );
  });
});
