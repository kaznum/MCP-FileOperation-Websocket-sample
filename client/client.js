import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';
const TOKEN_URL = process.env.OAUTH_TOKEN_URL;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const REQUESTED_SCOPE = process.env.OAUTH_SCOPE || 'file.read file.list';
const PRESET_ACCESS_TOKEN = process.env.OAUTH_ACCESS_TOKEN;

let ws;
let messageId = 0;

async function getAccessToken() {
  if (PRESET_ACCESS_TOKEN) {
    console.log('Using pre-configured OAuth access token from environment');
    return PRESET_ACCESS_TOKEN;
  }

  if (!TOKEN_URL) {
    throw new Error('OAUTH_TOKEN_URL must be set when OAUTH_ACCESS_TOKEN is not provided');
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be configured to request a token');
  }

  console.log(`Requesting OAuth access token from ${TOKEN_URL} (client_id=${CLIENT_ID})`);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: REQUESTED_SCOPE
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to obtain access token (${response.status}): ${errorText}`);
  }

  const tokenResponse = await response.json();
  if (!tokenResponse.access_token) {
    throw new Error('Token response did not include an access_token');
  }

  console.log('Successfully obtained OAuth access token via client credentials flow');
  return tokenResponse.access_token;
}

function sendMessage(message) {
  const id = ++messageId;
  const msg = { ...message, id };
  console.log('\n--- Sending message ---');
  console.log(JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));
  return id;
}

async function start() {
  console.log(`Connecting to MCP server at ${SERVER_URL}...`);
  console.log('Authentication: OAuth 2.1 (Bearer token)');

  const accessToken = await getAccessToken();

  ws = new WebSocket(SERVER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  ws.on('open', async () => {
    console.log('Connected to MCP server\n');

    // Initialize
    sendMessage({ type: 'initialize' });

    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 1: List files in root directory
    console.log('\n=== Test 1: List files in root directory ===');
    sendMessage({
      type: 'tool_call',
      name: 'list-files',
      arguments: {
        directory: '.'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 2: Read sample1.txt
    console.log('\n=== Test 2: Read sample1.txt ===');
    sendMessage({
      type: 'tool_call',
      name: 'read-file',
      arguments: {
        filePath: 'sample1.txt'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 3: Read sample2.txt
    console.log('\n=== Test 3: Read sample2.txt ===');
    sendMessage({
      type: 'tool_call',
      name: 'read-file',
      arguments: {
        filePath: 'sample2.txt'
      }
    });

    // Close connection after tests
    setTimeout(() => {
      console.log('\n\nAll tests completed. Closing connection...');
      ws.close();
    }, 1500);
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('\n--- Received response ---');
    console.log(JSON.stringify(message, null, 2));
  });

  ws.on('close', () => {
    console.log('\nDisconnected from MCP server');
    process.exit(0);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    process.exit(1);
  });
}

start().catch(error => {
  console.error('Failed to start MCP client:', error.message);
  process.exit(1);
});
