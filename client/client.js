import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';
const API_KEY = process.env.API_KEY;

console.log(`Connecting to MCP server at ${SERVER_URL}...`);
console.log(`Authentication: ${API_KEY ? 'enabled' : 'disabled'}`);

// Create WebSocket with API key in headers
const ws = new WebSocket(SERVER_URL, {
  headers: {
    'X-API-Key': API_KEY || ''
  }
});

let messageId = 0;

function sendMessage(message) {
  const id = ++messageId;
  const msg = { ...message, id };
  console.log('\n--- Sending message ---');
  console.log(JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));
  return id;
}

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
