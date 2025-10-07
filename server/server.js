import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const TARGET_DIR = process.env.TARGET_DIR || '/data';

// Load manifest
const manifest = JSON.parse(
  await fs.readFile(path.join(__dirname, 'manifest.json'), 'utf-8')
);

const wss = new WebSocketServer({ port: PORT });

console.log(`MCP Server listening on port ${PORT}`);
console.log(`Target directory: ${TARGET_DIR}`);

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
wss.on('connection', (ws) => {
  console.log('Client connected');

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
