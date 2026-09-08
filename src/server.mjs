import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

import { randomUUID } from 'node:crypto';

import { requireBearerToken } from './auth.mjs';
import { config } from './config.mjs';
import { SERVER_INSTRUCTIONS } from './chatgpt-behavior.mjs';
import { DrupalApiError, DrupalClient } from './drupal-client.mjs';
import {
  createSemaphore,
  createTokenBucket,
  logMcpEvent,
  mcpToolName,
} from './limits.mjs';

const drupalClient = new DrupalClient({
  baseUrl: config.drupalBaseUrl,
  username: config.drupalUsername,
  password: config.drupalPassword,
  timeoutMs: config.drupalTimeoutMs,
  maxResponseBytes: config.maxResponseBytes,
});

const mcpRateLimiter = createTokenBucket({
  capacity: config.rateBurst,
  refillPerMs: config.rateLimitPerMin / 60000,
});
const authFailureLimiter = createTokenBucket({
  capacity: config.rateBurst,
  refillPerMs: config.rateLimitPerMin / 60000,
});
const heavyConcurrency = createSemaphore(config.heavyConcurrency);

const fieldMap = z.record(z.string(), z.any());

const contentOutputSchema = {
  nid: z.number().int(),
  uuid: z.string(),
  content_type: z.string(),
  revision_id: z.number().int(),
  language: z.string(),
  fields: fieldMap,
};

const schemaFieldOutput = z.object({
  machine_name: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  cardinality: z.number().int(),
  default_value: z.any(),
  allowed_values: z.any(),
  reference_target_type: z.union([z.string(), z.null()]),
  reference_target_bundles: z.array(z.string()),
  translatable: z.boolean(),
  computed: z.boolean(),
  read_only: z.boolean(),
});

function toolError(summary, error, audit) {
  const parts = [summary];
  let code = 'internal';
  if (error instanceof DrupalApiError) {
    if (error.code) {
      parts.push(`code ${error.code}.`);
      code = error.code;
    }
    else if (error.status) {
      code = `http_${error.status}`;
    }
    if (error.status) {
      parts.push(`HTTP ${error.status}.`);
    }
    parts.push(error.message);
  }
  if (audit) {
    audit.code = code;
  }

  return {
    isError: true,
    content: [{ type: 'text', text: parts.join(' ') }],
  };
}

async function runHeavyTool(summary, audit, fn) {
  let release;
  try {
    release = await heavyConcurrency.acquire(config.heavyWaitMs);
  }
  catch {
    if (audit) {
      audit.code = 'busy';
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `${summary} code busy. Too many concurrent Drupal reads.` }],
    };
  }
  try {
    return await fn();
  }
  finally {
    release();
  }
}

function createServer(audit = null) {
  const server = new McpServer(
    {
      name: '4grow-marketing-data',
      version: '0.1.0',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    'list_content_types',
    {
      title: 'List Drupal content types',
      description:
        'Use this when the user asks which Drupal types exist or whether trainings, landing pages or quizzes are available. Lists the complete allowlist and revision/translation flags. Do not use it to list nodes.',
      inputSchema: {},
      outputSchema: {
        content_types: z.array(
          z.object({
            machine_name: z.string(),
            label: z.string(),
            revisions_enabled: z.boolean(),
            translatable: z.boolean(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const contentTypes = await drupalClient.get('/api/v1/content/types');
        const structuredContent = { content_types: contentTypes };

        return {
          structuredContent,
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredContent),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content types.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content_type_schema',
    {
      title: 'Get Drupal content type schema',
      description:
        'Use this before search_content or get_content when a field machine name is unknown. Returns the dynamic field schema for npxtraining, landing_page or npxquiz. Do not guess field names.',
      inputSchema: {
        content_type: z.string().min(1).max(64).describe('Drupal content type machine name.'),
      },
      outputSchema: {
        machine_name: z.string(),
        label: z.string(),
        revisions_enabled: z.boolean(),
        translatable: z.boolean(),
        fields: z.array(schemaFieldOutput),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ content_type: contentType }) => {
      try {
        const schema = await drupalClient.get(
          `/api/v1/content/types/${encodeURIComponent(contentType)}/schema`,
        );

        return {
          structuredContent: schema,
          content: [
            {
              type: 'text',
              text: JSON.stringify(schema),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content type schema.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content',
    {
      title: 'Get Drupal content',
      description:
        'Use this when the user has a numeric NID and wants the current fields of one training, landing page or quiz. Optionally request selected field machine names. For a landing page H1 expand field_top_tytul, not title. For quiz questions expand field_questions and field_questions.field_answers. Do not use this for history or to create or edit content. Scoring fields and participant or npx_test entities are never returned.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        fields: z.array(z.string().min(1).max(128)).max(50).optional()
          .describe('Optional Drupal or logical field names to return.'),
        expand: z.array(z.string().min(1).max(128)).max(10).optional()
          .describe(
            'Explicit entity-reference field paths to expand. For a landing page H1 use field_top_tytul. '
            + 'For quiz structure use field_questions and field_questions.field_answers. '
            + 'Scoring fields and participant or npx_test entities are never returned.',
          ),
      },
      outputSchema: contentOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ nid, fields, expand }) => {
      try {
        const query = new URLSearchParams();
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (expand !== undefined) {
          query.set('expand', expand.join(','));
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const content = await drupalClient.get(`/api/v1/content/${nid}${suffix}`);

        return {
          structuredContent: content,
          content: [
            {
              type: 'text',
              text: JSON.stringify(content),
            },
          ],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal content.', error, audit);
      }
    },
  );

  server.registerTool(
    'get_content_revisions',
    {
      title: 'List Drupal content revisions',
      description:
        'Use this when the user asks when a value changed, who edited it, or wants revision history of one NID. '
        + 'Returns paginated revision history for one accessible Drupal node, newest revision first by default. '
        + 'Without "fields" it returns revision metadata only. Pass "fields" to also read what those fields '
        + 'held in each revision, and add "changes_only" to keep just the revisions where they changed — that '
        + 'is how to answer when a price, title or meta description was last edited. '
        + 'With "changes_only" every returned item is the revision that introduced the value it carries, so '
        + 'its author and timestamp are the author and date of that change, in both orders. '
        + '"compared_to_revision_id" names the revision holding the previous value, so the boundary is '
        + 'unambiguous. The separate "reference" is the state the comparisons started from: it is the newest '
        + 'revision read, not a change, because nothing older had been compared to it yet. '
        + 'One call examines a bounded number of revisions and reports "examined"; when "has_more" is true, '
        + 'continue with "after_revision_id" set to "next_after_revision_id". "scan_limit_reached" tells the '
        + 'two endings apart: true means the call stopped at its work limit and older revisions remain, false '
        + 'together with a false "has_more" means the whole history was read. A page may legitimately contain '
        + 'no changes while older ones still do, so keep paging until "has_more" is false before concluding '
        + 'that a value never changed. A non-zero "inaccessible" means some revisions could not be read, so a '
        + 'reported change may in truth have happened in one of the hidden revisions between the two named. '
        + 'A full page is not a complete history. Do not say the history is complete until "has_more" is false; '
        + 'until then the result is partial.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        limit: z.number().int().min(1).max(100).default(50),
        after_revision_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
          .describe('Cursor. Continues after this revision in the selected order.'),
        order: z.enum(['desc', 'asc']).default('desc')
          .describe('Revision order. "desc" returns the newest revisions first.'),
        fields: z.array(z.string().min(1).max(128)).min(1).max(20).optional()
          .describe(
            'Field names to read for every revision. Keep the list short, because each revision is loaded '
            + 'separately and wide selections are slow.',
          ),
        changes_only: z.boolean().default(false)
          .describe(
            'Return only the revisions that introduced a new value for the selected fields, plus the '
            + '"reference" state the comparison started from. Requires "fields".',
          ),
      },
      outputSchema: {
        nid: z.number().int(),
        current_revision_id: z.number().int(),
        items: z.array(z.record(z.string(), z.any())),
        count: z.number().int(),
        limit: z.number().int(),
        order: z.enum(['desc', 'asc']),
        changes_only: z.boolean(),
        examined: z.number().int(),
        inaccessible: z.number().int(),
        scan_limit_reached: z.boolean(),
        has_more: z.boolean(),
        next_after_revision_id: z.union([z.number().int(), z.null()]),
        reference: z.record(z.string(), z.any()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      nid,
      limit,
      after_revision_id: afterRevisionId,
      order,
      fields,
      changes_only: changesOnly,
    }) => runHeavyTool('Could not read Drupal revisions.', audit, async () => {
      try {
        const query = new URLSearchParams({ limit: String(limit), order });
        if (afterRevisionId !== undefined) {
          query.set('after_revision_id', String(afterRevisionId));
        }
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (changesOnly) {
          query.set('changes_only', '1');
        }
        const result = await drupalClient.get(
          `/api/v1/content/${nid}/revisions?${query.toString()}`,
        );
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal revisions.', error, audit);
      }
    }),
  );

  server.registerTool(
    'get_content_revision',
    {
      title: 'Get Drupal content revision',
      description:
        'Use this to read one known revision by nid and revision_id. Do not walk history with this tool; list revisions first. '
        + 'Returns one accessible Drupal revision with optional selected fields.',
      inputSchema: {
        nid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Numeric Drupal node ID.'),
        revision_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
          .describe('Drupal revision ID.'),
        fields: z.array(z.string().min(1).max(128)).max(50).optional(),
        expand: z.array(z.string().min(1).max(128)).max(10).optional()
          .describe(
            'Explicit entity-reference field paths to expand. Scoring and npx_test entities are never returned.',
          ),
      },
      outputSchema: {
        nid: z.number().int(),
        uuid: z.string(),
        content_type: z.string(),
        revision_id: z.number().int(),
        current_revision: z.boolean(),
        language: z.string(),
        revision_author: z.any().nullable(),
        revision_timestamp: z.number().int(),
        revision_log: z.union([z.string(), z.null()]),
        fields: fieldMap,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ nid, revision_id: revisionId, fields, expand }) => {
      try {
        const query = new URLSearchParams();
        if (fields !== undefined) {
          query.set('fields', fields.join(','));
        }
        if (expand !== undefined) {
          query.set('expand', expand.join(','));
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const result = await drupalClient.get(
          `/api/v1/content/${nid}/revisions/${revisionId}${suffix}`,
        );
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not read Drupal revision.', error, audit);
      }
    },
  );


  server.registerTool(
    'search_content',
    {
      title: 'Search Drupal content',
      description:
        'Use this to find or list trainings, landing pages or quizzes with structured filters. '
        + 'Call get_content_type_schema first if the field name is unknown. If a required filter is missing, ask one short question instead of guessing. '
        + 'Never accepts SQL or raw query expressions. '
        + 'One call returns at most "limit" matches and scans at most 5000 candidate nodes. '
        + 'A full page is not a complete list: if "has_more" is true, continue with "after_nid" set to "next_after_nid". '
        + '"scan_limit_reached" tells the two endings apart: true means this call stopped at the 5000-candidate '
        + 'work limit and later nodes were not scanned, so keep paging even if this page is short or empty. '
        + 'False together with a false "has_more" means the scan really ended. '
        + 'Do not say every match was found until "has_more" is false. Until then the result is partial. '
        + 'A non-zero "inaccessible" means candidate nodes were skipped because a filtered field could not be '
        + 'read, so an absent node is not proof that it fails the filter.',
      inputSchema: {
        content_type: z.string().min(1).max(64),
        conditions: z.array(
          z.object({
            field: z.string().min(1).max(128),
            operator: z.enum([
              'equals',
              'not_equals',
              'empty',
              'not_empty',
              'contains',
              'in',
              'before',
              'after',
            ]),
            value: z.union([
              z.string().max(500),
              z.number(),
              z.boolean(),
              z.array(z.union([z.string().max(500), z.number(), z.boolean()])).min(1).max(50),
            ]).optional(),
          }),
        ).max(10).default([]),
        fields: z.array(z.string().min(1).max(128)).min(1).max(50),
        limit: z.number().int().min(1).max(100).default(50),
        after_nid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
          .describe('Cursor. Continues after this nid. Use next_after_nid from the previous page.'),
      },
      outputSchema: {
        items: z.array(z.record(z.string(), z.any())),
        count: z.number().int(),
        limit: z.number().int(),
        has_more: z.boolean(),
        next_after_nid: z.union([z.number().int(), z.null()]),
        scan_limit_reached: z.boolean(),
        inaccessible: z.number().int(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => runHeavyTool('Could not search Drupal content.', audit, async () => {
      try {
        const result = await drupalClient.post('/api/v1/content/search', input);
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
      catch (error) {
        return toolError('Could not search Drupal content.', error, audit);
      }
    }),
  );

  return server;
}

const app = createMcpExpressApp({
  host: '127.0.0.1',
  allowedHosts: config.allowedHosts,
});

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/mcp', requireBearerToken(config.mcpAuthToken, {
  failureLimiter: authFailureLimiter,
  onFailure: (request, code) => logMcpEvent({
    requestId: randomUUID(),
    tool: mcpToolName(request.body),
    durationMs: 0,
    result: 'error',
    code,
  }),
}));

app.use('/mcp', (request, response, next) => {
  if (request.method !== 'POST') {
    next();
    return;
  }
  if (!mcpRateLimiter.take()) {
    const requestId = randomUUID();
    logMcpEvent({
      requestId,
      tool: mcpToolName(request.body),
      durationMs: 0,
      result: 'error',
      code: 'rate_limited',
    });
    response.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32002, message: 'Rate limit exceeded.' },
      id: request.body?.id ?? null,
    });
    return;
  }
  next();
});

app.post('/mcp', async (request, response) => {
  const requestId = randomUUID();
  const tool = mcpToolName(request.body);
  const started = Date.now();
  const audit = { code: null };
  const server = createServer(audit);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let released = false;
  const releaseTransport = () => {
    if (released) {
      return;
    }
    released = true;
    transport.close();
    server.close();
  };
  response.on('close', releaseTransport);

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    logMcpEvent({
      requestId,
      tool,
      durationMs: Date.now() - started,
      result: audit.code === null ? 'ok' : 'error',
      code: audit.code,
    });
  }
  catch (error) {
    logMcpEvent({
      requestId,
      tool,
      durationMs: Date.now() - started,
      result: 'error',
      code: 'internal',
    });
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error.' },
        id: null,
      });
    }
  }
  finally {
    if (response.closed || response.destroyed) {
      releaseTransport();
    }
  }
});

app.get('/mcp', (_request, response) => {
  response.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

app.delete('/mcp', (_request, response) => {
  response.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

const httpServer = app.listen(config.port, '127.0.0.1', (error) => {
  if (error) {
    console.error('Could not start MCP server:', error.message);
    process.exit(1);
  }
  console.log(`4GROW Marketing Data MCP listening on http://127.0.0.1:${config.port}/mcp`);
});

function shutdown() {
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
