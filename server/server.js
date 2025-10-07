import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const TARGET_DIR = process.env.TARGET_DIR || '/data';
const OAUTH_ISSUER = process.env.OAUTH_ISSUER;
const OAUTH_AUDIENCE = process.env.OAUTH_AUDIENCE || 'mcp-server';
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL;
const OAUTH_REQUIRED_SCOPES = (process.env.OAUTH_REQUIRED_SCOPES || '')
  .split(/\s+/)
  .filter(Boolean);

if (!OAUTH_ISSUER || !OAUTH_JWKS_URL) {
  throw new Error('OAuth 2.1 is required: set OAUTH_ISSUER and OAUTH_JWKS_URL environment variables.');
}

const jwks = createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

async function verifyAccessToken(token) {
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: OAUTH_ISSUER,
    audience: OAUTH_AUDIENCE
  });

  if (OAUTH_REQUIRED_SCOPES.length > 0) {
    const tokenScopes = new Set(
      (Array.isArray(payload.scope) ? payload.scope.join(' ') : payload.scope || '')
        .split(/\s+/)
        .filter(Boolean)
    );

    const missingScopes = OAUTH_REQUIRED_SCOPES.filter(scope => !tokenScopes.has(scope));
    if (missingScopes.length > 0) {
      throw new Error(`Missing required scopes: ${missingScopes.join(', ')}`);
    }
  }

  return payload;
}

// Load manifest
const manifest = JSON.parse(
  await fs.readFile(path.join(__dirname, 'manifest.json'), 'utf-8')
);

const wss = new WebSocketServer({
  port: PORT,
  verifyClient: (info, callback) => {
    try {
      const authHeader = info.req.headers['authorization'];
      if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
        console.error('Authentication failed: Missing Bearer token');
        callback(false, 401, 'Unauthorized: Bearer token required');
        return;
      }

      const token = authHeader.substring(7).trim();
      verifyAccessToken(token)
        .then(payload => {
          info.req.authContext = payload;
          console.log(`Client authenticated: subject=${payload.sub ?? 'unknown'}`);
          callback(true);
        })
        .catch(error => {
          console.error(`Authentication failed: ${error.message}`);
          callback(false, 401, 'Unauthorized: Invalid or expired token');
        });
    } catch (error) {
      console.error('Authentication failure:', error);
      callback(false, 500, 'Internal Server Error');
    }
  }
});

console.log(`MCP Server listening on port ${PORT}`);
console.log(`Target directory: ${TARGET_DIR}`);
console.log(`Authentication: OAuth 2.1 (issuer: ${OAUTH_ISSUER}, audience: ${OAUTH_AUDIENCE})`);

// Helper function to resolve paths safely
function resolvePath(relativePath) {
  const resolved = path.resolve(TARGET_DIR, relativePath);
  if (!resolved.startsWith(TARGET_DIR)) {
    throw new Error('Access denied: Path outside target directory');
  }
  return resolved;
}

// Tool implementations
async function listFiles(directory) {
  try {
    const dirPath = resolvePath(directory);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: path.join(directory, entry.name)
    }));

    return {
      success: true,
      files
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function readFile(filePath) {
  try {
    const fullPath = resolvePath(filePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    return {
      success: true,
      content,
      path: filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('Client connected');
  ws.authContext = req?.authContext;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received message:', message);

      let response;

      switch (message.type) {
        case 'initialize':
          response = {
            type: 'initialized',
            manifest,
            serverInfo: {
              name: 'file-operations-mcp',
              version: '1.0.0'
            }
          };
          break;

        case 'tool_call':
          const { name, arguments: args } = message;
          let result;

          switch (name) {
            case 'list-files':
              result = await listFiles(args.directory);
              break;

            case 'read-file':
              result = await readFile(args.filePath);
              break;

            default:
              result = {
                success: false,
                error: `Unknown tool: ${name}`
              };
          }

          response = {
            type: 'tool_result',
            id: message.id,
            result
          };
          break;

        default:
          response = {
            type: 'error',
            error: `Unknown message type: ${message.type}`
          };
      }

      ws.send(JSON.stringify(response));
      console.log('Sent response:', response);

    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});
