import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({
  name: '4grow-local-smoke-test',
  version: '0.1.0',
});

const token = process.env.MCP_AUTH_TOKEN?.trim();
if (!token) {
  throw new Error('Missing required environment variable: MCP_AUTH_TOKEN');
}

const transport = new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:3000/mcp'),
  {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  },
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const result = await client.callTool({
    name: 'list_content_types',
    arguments: {},
  });

  console.log(JSON.stringify({ tools: tools.tools, result }, null, 2));
}
finally {
  await client.close();
}
