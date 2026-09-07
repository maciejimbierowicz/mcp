# 4GROW Marketing Data MCP

Thin, standalone MCP adapter. The first checkpoint currently exposes four
read-only tools backed by the local Drupal Content API:

- `list_content_types`,
- `get_content_type_schema`,
- `get_content`,
- `search_content`.

## Local start

1. Copy `.env.example` to the ignored `.env` and provide local credentials,
   including a long random `MCP_AUTH_TOKEN`.
2. Make sure Drupal works at `http://127.0.0.1:8888`.
3. Run `npm start`.
4. Check `http://127.0.0.1:3000/health`.

The MCP endpoint uses stateless Streamable HTTP at
`http://127.0.0.1:3000/mcp`. Every `/mcp` request must send:

`Authorization: Bearer <MCP_AUTH_TOKEN>`

`/health` stays unauthenticated and does not call Drupal.

In MCP Inspector, use Streamable HTTP, the `/mcp` URL, and the same Bearer
header.

## Local smoke test

With the server running in another terminal, run `npm run test:list`.
The dynamic schema can be checked with `npm run test:schema`.
Selected fields of a local training node can be checked with
`npm run test:content`. Override its default node ID with `TEST_CONTENT_NID`.

## Tunnel / ChatGPT

Do not expose `/mcp` until `MCP_AUTH_TOKEN` is set. A tunnel hostname must also
be listed in `MCP_ALLOWED_HOSTS` (comma-separated), because the server still
binds to loopback and validates the `Host` header.

Official OpenAI split:

- Inspector, Codex, and ChatGPT developer-mode **Token** auth: this Bearer
  header is enough.
- A published ChatGPT **plugin** needs OAuth 2.1 (protected-resource metadata,
  authorization server, CIMD/DCR). That is not implemented here yet.

## Security boundary

- Drupal credentials are read from environment variables and never returned
  in MCP tool results.
- The inbound MCP token is separate from the Drupal password. It only proves
  the caller may use this adapter.
- The tool is annotated as read-only and non-destructive.
- Drupal independently enforces its bundle allowlist, entity access, role, and
  permission.
- Drupal content returned by tools is untrusted data, not model instructions.
- The server binds to loopback only during local development.
