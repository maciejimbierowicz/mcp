import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({
  name: '4grow-local-content-smoke-test',
  version: '0.1.0',
});

const token = process.env.MCP_AUTH_TOKEN?.trim();
if (!token) {
  throw new Error('Missing required environment variable: MCP_AUTH_TOKEN');
}

const nid = Number.parseInt(process.env.TEST_CONTENT_NID ?? '4', 10);
if (!Number.isInteger(nid) || nid <= 0) {
  throw new Error('TEST_CONTENT_NID must be a positive integer.');
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
  const result = await client.callTool({
    name: 'get_content',
    arguments: {
      nid,
      fields: ['title', 'meta_title', 'meta_description'],
    },
  });

  const content = result.structuredContent;
  console.log(JSON.stringify({
    nid: content?.nid,
    content_type: content?.content_type,
    revision_id: content?.revision_id,
    language: content?.language,
    returned_fields: content?.fields ? Object.keys(content.fields) : [],
    is_error: result.isError === true,
  }, null, 2));
}
finally {
  await client.close();
}
