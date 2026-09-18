import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({
  name: '4grow-local-schema-smoke-test',
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
  const result = await client.callTool({
    name: 'get_content_type_schema',
    arguments: {
      content_type: 'npxtraining',
    },
  });

  const schema = result.structuredContent;
  console.log(JSON.stringify({
    machine_name: schema?.machine_name,
    label: schema?.label,
    revisions_enabled: schema?.revisions_enabled,
    translatable: schema?.translatable,
    field_count: Array.isArray(schema?.fields) ? schema.fields.length : null,
    contains_meta_title: schema?.fields?.some((field) => field.machine_name === 'meta_title'),
    contains_meta_description: schema?.fields?.some(
      (field) => field.machine_name === 'meta_description',
    ),
    is_error: result.isError === true,
  }, null, 2));
}
finally {
  await client.close();
}
