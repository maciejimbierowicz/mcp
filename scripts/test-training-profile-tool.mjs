import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const token = process.env.MCP_AUTH_TOKEN?.trim();
if (!token) {
  throw new Error('Missing required environment variable: MCP_AUTH_TOKEN');
}

const port = Number.parseInt(process.env.MCP_PORT ?? '3000', 10);
const client = new Client({
  name: '4grow-training-profile-contract-test',
  version: '0.1.0',
});
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${port}/mcp`),
  {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  },
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const getContent = tools.tools.find((tool) => tool.name === 'get_content');
  assert(getContent, 'get_content must be registered.');
  assert(
    getContent.inputSchema?.properties?.profile?.enum?.includes('training_editorial'),
    'get_content must advertise the training_editorial profile.',
  );
  assert(
    getContent.description?.includes('complete editorial npxtraining read'),
    'get_content must explain when the profile should be used.',
  );

  console.log(JSON.stringify({
    tool: getContent.name,
    profiles: getContent.inputSchema.properties.profile.enum,
    required: getContent.inputSchema.required ?? [],
  }, null, 2));
}
finally {
  await client.close();
}
